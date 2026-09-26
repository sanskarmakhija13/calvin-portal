const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const multer = require('multer');
const auth = require('../middleware/auth');
const User = require('../models/User');
const CCA = require('../models/CCA');
const SelectionWorkspace = require('../models/SelectionWorkspace');

const router = express.Router();
const uploadRoot = path.join(__dirname, '..', 'uploads');
const taskUploadRoot = path.join(__dirname, '..', 'uploads', 'tasks');
const taskTempRoot = path.join(taskUploadRoot, 'tmp');
const roundUploadRoot = path.join(__dirname, '..', 'uploads', 'rounds');
fs.mkdirSync(taskTempRoot, { recursive: true });
fs.mkdirSync(roundUploadRoot, { recursive: true });
const taskUpload = multer({
  dest: taskTempRoot,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'application/x-zip-compressed'].includes(file.mimetype))
});
const allowedRoles = new Set(['student', 'cca', 'senate', 'admin']);
const roundTypes = new Set(['Individual · Task', 'Individual · Task + Interview', 'Individual · Interview', 'Group · Task', 'Group · Task + Interview', 'Group · Interview']);
const interviewRoundTypes = new Set([...roundTypes].filter((type) => type.includes('Interview')));
const CV_REVIEW_TYPE = 'CV Review · No elimination';
const PORTAL_ADMIN_EMAILS = new Set(['km@iiml.ac.in', ...(process.env.NODE_ENV === 'production' ? [] : ['newuser123@example.com'])]);
const id = () => new mongoose.Types.ObjectId().toString();
const now = () => new Date().toISOString();

const workspaceFor = async () => SelectionWorkspace.findOneAndUpdate(
  { key: 'default' },
  { $setOnInsert: { key: 'default' } },
  { new: true, upsert: true, setDefaultsOnInsert: true }
);

const addAudit = (workspace, actor, role, action, entity, detail = {}) => {
  workspace.audit.unshift({ id: id(), actor, role, action, entity, detail, createdAt: now() });
  workspace.revision += 1;
};

const addNotification = (workspace, text, userId = null, ccaId = null) => {
  workspace.notifications.push({ id: id(), text, userId, ccaId, readBy: [], createdAt: now() });
};
const controlEnabled = (workspace, ccaId, control) => workspace.ccaControls?.[String(ccaId)]?.[control] !== false;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const isScreening = (round) => String(round?.type || '').startsWith('Screening');
const isCVReview = (round) => String(round?.type || '') === CV_REVIEW_TYPE;
const makeCVReviewRound = () => ({
  name: 'CV review', type: CV_REVIEW_TYPE, maxMarks: 0, taskMaxMarks: 0, interviewMaxMarks: 0,
  weight: 0, deadline: null,
  instructions: 'This is an application review stage. Everyone remains eligible and no task or marks are required. Wait for Round 1 instructions.',
  criteria: 'CV review only. Do not score or eliminate applicants.', status: 'Draft'
});
const ensureCVReviewRound = (cca) => {
  if (cca.rounds.some(isCVReview)) return cca.rounds.find(isCVReview);
  if (cca.rounds.length && isScreening(cca.rounds[0])) {
    const review = cca.rounds[0];
    review.name = 'CV review';
    review.type = CV_REVIEW_TYPE;
    review.maxMarks = 0;
    review.taskMaxMarks = 0;
    review.interviewMaxMarks = 0;
    review.weight = 0;
    review.deadline = null;
    review.instructions = makeCVReviewRound().instructions;
    review.criteria = makeCVReviewRound().criteria;
    review.status = 'Draft';
    review.startedAt = null;
    review.completedAt = null;
    cca.currentRound = 0;
    return review;
  }
  cca.rounds.unshift(makeCVReviewRound());
  cca.currentRound = 0;
  return cca.rounds[0];
};
const isInterview = (round) => interviewRoundTypes.has(String(round?.type || ''));
const isTask = (round) => String(round?.type || '').includes('Task');
const belongsToCCA = (user, role, ccaId) => role === 'senate' || (role === 'cca' && String(user.ccaAssignment || '') === String(ccaId));
const isActiveApplication = (user, ccaId) => (user.selectionApplications || []).some((item) => String(item.cca) === String(ccaId) && ['Applied', 'Participating'].includes(item.status));
const panelRunStudent = (run, userId) => run?.students?.find((item) => String(item.userId) === String(userId));
const addPanelException = (workspace, run, userId, kind, reason) => {
  if (workspace.exceptions.some((item) => item.kind === kind && item.panelRunId === run.id && item.userId === String(userId) && item.status === 'Open')) return;
  workspace.exceptions.push({ id: id(), kind, ccaId: String(run.ccaId), panelRunId: run.id, userId: String(userId), reason, status: 'Open', createdAt: now() });
};
const roundFor = (cca, roundId) => cca?.rounds?.id(roundId);
const buildApplications = (users) => users.flatMap((user) => {
  const ranked = (user.rankedCCAs || []).map(String);
  const cvByCCA = new Map((user.applicationCVs || []).map((entry) => [String(entry.cca), String(entry.cv)]));
  const cvDetails = new Map((user.cvs || []).map((entry) => [String(entry._id), entry]));
  const details = new Map((user.selectionApplications || []).map((entry) => [String(entry.cca), entry]));
  return (user.appliedCCAs || []).map((ccaId) => {
    const cca = String(ccaId);
    const detail = details.get(cca);
    const rankedIndex = ranked.indexOf(cca);
    return {
      id: detail?._id?.toString() || `${user._id}-${cca}`,
      userId: user._id.toString(),
      studentName: user.fullName || user.email.split('@')[0],
      email: user.email,
      rollNumber: user.rollNumber || '',
      ccaId: cca,
      cvId: detail?.cv?.toString() || cvByCCA.get(cca) || null,
      cvFilename: cvDetails.get(detail?.cv?.toString() || cvByCCA.get(cca) || '')?.filename || null,
      vertical: detail?.vertical || 'General',
      preference: detail?.preference || (rankedIndex === -1 ? 0 : rankedIndex + 1),
      status: detail?.status || 'Applied',
      createdAt: detail?.createdAt || user._id.getTimestamp()
    };
  });
});

const scoreFor = (workspace, cca, userId) => (cca.rounds || []).reduce((sum, round) => {
  const evaluation = workspace.evaluations.find((item) => item.ccaId === cca._id.toString() && item.roundId === round._id.toString() && item.userId === userId);
  if (!evaluation || !round.maxMarks) return sum;
  const correction = workspace.markCorrections.filter((item) => item.evaluationId === evaluation.id).at(-1);
  return sum + (Number(correction?.total ?? evaluation.total) / Number(round.maxMarks)) * Number(round.weight || round.maxMarks);
}, 0);
const rawRoundScore = (workspace, round, userId) => {
  const evaluation = workspace.evaluations.find((item) => item.roundId === String(round?._id) && item.userId === userId);
  if (!evaluation) return 0;
  return Number(workspace.markCorrections.filter((item) => item.evaluationId === evaluation.id).at(-1)?.total ?? evaluation.total);
};

const contextFor = async (req) => {
  const user = await User.findById(req.userId);
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  const isPortalAdmin = PORTAL_ADMIN_EMAILS.has(user.email.toLowerCase());
  const preview = process.env.NODE_ENV !== 'production' && isPortalAdmin ? req.query.previewRole || req.body?.previewRole : null;
  const requestedRole = allowedRoles.has(preview) ? preview : user.role || 'student';
  const role = isPortalAdmin && (requestedRole === 'admin' || process.env.NODE_ENV === 'production') ? 'senate' : requestedRole;
  return { user, role, isPortalAdmin };
};

router.get('/stage', auth, async (req, res) => {
  try {
    const workspace = await workspaceFor();
    res.json({ stage: workspace.stage || 'applications', cycle: workspace.cycle });
  } catch (error) {
    res.status(500).json({ msg: 'Could not read the portal stage.' });
  }
});

router.post('/submission-file', auth, taskUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ msg: 'Upload a PDF, document, presentation, or ZIP file.' });
  try {
    const workspace = await workspaceFor();
    if ((workspace.stage || 'applications') !== 'selection') {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ msg: 'Task uploads open only when the selection workspace is active.' });
    }
    const userFolder = path.join(taskUploadRoot, req.userId.toString());
    fs.mkdirSync(userFolder, { recursive: true });
    const extension = path.extname(req.file.originalname).toLowerCase() || '.file';
    const fileKey = `${crypto.randomUUID()}${extension}`;
    fs.renameSync(req.file.path, path.join(userFolder, fileKey));
    res.status(201).json({ fileKey, filename: req.file.originalname, size: req.file.size });
  } catch (error) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ msg: 'Could not store the task file.' });
  }
});

router.post('/round-file', auth, taskUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ msg: 'Choose a PDF, document, presentation, or ZIP file.' });
  try {
    const { user, role, isPortalAdmin } = await contextFor(req);
    const workspace = await workspaceFor();
    if (!['applications', 'configuration', 'selection'].includes(workspace.stage || 'applications')) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ msg: 'Round documents can only be added during setup or selection.' });
    }
    if (role !== 'cca' && !(process.env.NODE_ENV !== 'production' && isPortalAdmin && req.body?.previewRole === 'cca')) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ msg: 'CCA access is required to upload round documents.' });
    }
    const extension = path.extname(req.file.originalname).toLowerCase() || '.file';
    const fileKey = `${crypto.randomUUID()}${extension}`;
    fs.renameSync(req.file.path, path.join(roundUploadRoot, fileKey));
    res.status(201).json({ fileKey, name: req.file.originalname });
  } catch (error) {
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(error.status || 500).json({ msg: error.message || 'Could not upload the round document.' });
  }
});

router.get('/round-file/:fileKey', auth, async (req, res) => {
  try {
    const { user, role, isPortalAdmin } = await contextFor(req);
    if (!/^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(req.params.fileKey)) return res.status(404).json({ msg: 'Document not found.' });
    const ccas = await CCA.find({ 'rounds.documents.fileKey': req.params.fileKey });
    const match = ccas.flatMap((cca) => cca.rounds.filter((round) => round.documents.some((document) => document.fileKey === req.params.fileKey)).map((round) => ({ cca, round })))[0];
    if (!match) return res.status(404).json({ msg: 'Document not found.' });
    const localPreview = process.env.NODE_ENV !== 'production' && isPortalAdmin && role === 'cca' && req.query.previewRole === 'cca';
    const allowed = role === 'senate' || role === 'admin' || (role === 'cca' && (String(user.ccaAssignment) === String(match.cca._id) || localPreview))
      || (role === 'student' && match.round.publishedAt && (user.appliedCCAs || []).some((id) => String(id) === String(match.cca._id)));
    if (!allowed) return res.status(403).json({ msg: 'This round document is not available to your account.' });
    const filePath = path.join(roundUploadRoot, req.params.fileKey);
    if (!fs.existsSync(filePath)) return res.status(404).json({ msg: 'Document file not found.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.sendFile(filePath);
  } catch (error) {
    res.status(error.status || 500).json({ msg: error.message || 'Could not open the round document.' });
  }
});

router.get('/submission-file/:fileKey', auth, async (req, res) => {
  try {
    const { user, role, isPortalAdmin } = await contextFor(req);
    const workspace = await workspaceFor();
    const submission = workspace.submissions.find((item) => item.fileKey === req.params.fileKey);
    if (!submission) return res.status(404).json({ msg: 'Submission not found.' });
    const localCCAAccess = process.env.NODE_ENV !== 'production' && isPortalAdmin && role === 'cca' && req.query.ccaId === submission.ccaId;
    const allowed = role === 'senate' || submission.userId === user._id.toString() || (role === 'cca' && (user.ccaAssignment?.toString() === submission.ccaId || localCCAAccess));
    if (!allowed) return res.status(403).json({ msg: 'Access denied.' });
    const filePath = path.join(taskUploadRoot, submission.userId, submission.fileKey);
    if (!fs.existsSync(filePath)) return res.status(404).json({ msg: 'File not found.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.download(filePath, submission.filename);
  } catch (error) {
    res.status(error.status || 500).json({ msg: error.message || 'Server Error' });
  }
});

router.get('/', auth, async (req, res) => {
  try {
    const { user, role, isPortalAdmin } = await contextFor(req);
    const [workspace, ccas, users] = await Promise.all([
      workspaceFor(),
      CCA.find().sort({ name: 1 }),
      User.find().select('email fullName rollNumber role ccaAssignment appliedCCAs rankedCCAs applicationCVs cvs selectionApplications')
    ]);
    const allApplications = buildApplications(users);
    let panelAlertsAdded = false;
    for (const run of workspace.panelRuns || []) {
      if (run.status !== 'Active') continue;
      for (const attendance of run.students || []) {
        if (attendance.ccaOutAt && !attendance.evaluationId && attendance.scoreDueAt && Date.now() > Date.parse(attendance.scoreDueAt)) {
          const before = workspace.exceptions.length;
          addPanelException(workspace, run, attendance.userId, 'missingPanelMarks', `Marks were not entered within 10 minutes after CCA checkout for ${attendance.studentName || 'a student'}.`);
          panelAlertsAdded ||= workspace.exceptions.length > before;
        }
      }
    }
    if (panelAlertsAdded) { workspace.markModified('exceptions'); await workspace.save(); }
    if (role === 'student' && workspace.stage === 'selection') {
      let remindersAdded = false;
      for (const application of allApplications.filter((item) => item.userId === String(user._id) && ['Applied', 'Participating'].includes(item.status))) {
        const cca = ccas.find((item) => String(item._id) === application.ccaId);
        const round = cca?.rounds?.[cca.currentRound || 0];
        const remaining = round?.deadline ? new Date(round.deadline).getTime() - Date.now() : Infinity;
        if (!round || round.status !== 'Active' || !isTask(round) || remaining < 0 || remaining > 24 * 60 * 60 * 1000) continue;
        if (workspace.submissions.some((item) => item.roundId === String(round._id) && item.students?.includes(String(user._id)))) continue;
        if (workspace.notifications.some((item) => item.type === 'deadlineReminder' && item.roundId === String(round._id) && item.userId === String(user._id))) continue;
        workspace.notifications.push({ id: id(), type: 'deadlineReminder', roundId: String(round._id), text: `Task deadline approaching · ${cca.name} · ${round.name}`, userId: String(user._id), ccaId: String(cca._id), readBy: [], createdAt: now() });
        remindersAdded = true;
      }
      if (remindersAdded) { workspace.markModified('notifications'); await workspace.save(); }
    }
    if (role === 'senate' && workspace.stage === 'selection') {
      let alertsAdded = false;
      for (const cca of ccas) {
        const round = cca.rounds[cca.currentRound || 0];
        if (!round || round.status !== 'Active' || !round.deadline || new Date(round.deadline).getTime() >= Date.now()) continue;
        const count = allApplications.filter((item) => item.ccaId === String(cca._id) && ['Applied', 'Participating'].includes(item.status) && !(isScreening(round) ? workspace.screeningDecisions : workspace.evaluations).some((entry) => entry.roundId === String(round._id) && entry.userId === item.userId)).length;
        if (count && !workspace.exceptions.some((item) => item.kind === 'overdueRound' && item.roundId === String(round._id) && item.status === 'Open')) {
          workspace.exceptions.push({ id: id(), kind: 'overdueRound', ccaId: String(cca._id), roundId: String(round._id), reason: `${count} evaluation(s) pending after ${round.name} deadline`, status: 'Open', createdAt: now() });
          alertsAdded = true;
        }
      }
      for (const session of workspace.sessions) {
        if (!['Active', 'Evaluation pending'].includes(session.status) || Date.now() - Date.parse(session.time) < 60 * 60 * 1000) continue;
        if (!workspace.exceptions.some((item) => item.kind === 'stalledInterview' && item.sessionId === session.id && item.status === 'Open')) {
          workspace.exceptions.push({ id: id(), kind: 'stalledInterview', ccaId: session.ccaId, sessionId: session.id, reason: `Interview is still ${session.status.toLowerCase()} more than one hour after its scheduled time`, status: 'Open', createdAt: now() });
          alertsAdded = true;
        }
      }
      if (alertsAdded) { workspace.markModified('exceptions'); await workspace.save(); }
    }
    const requestedCCA = req.query.ccaId;
    const ccaId = role === 'cca'
      ? (process.env.NODE_ENV !== 'production' && isPortalAdmin ? requestedCCA || user.ccaAssignment?.toString() || ccas[0]?._id.toString() : user.ccaAssignment?.toString())
      : requestedCCA || null;
    const applications = role === 'student'
      ? allApplications.filter((application) => application.userId === user._id.toString())
      : role === 'cca'
        ? allApplications.filter((application) => application.ccaId === ccaId).map(({ preference, ...application }) => application)
        : allApplications;
    const visibleCCAs = role === 'cca' ? ccas.filter((cca) => cca._id.toString() === ccaId) : role === 'student'
      ? ccas.filter((item) => applications.some((application) => application.ccaId === String(item._id))).map((item) => {
        const copy = item.toObject();
        const originalIndex = copy.currentRound || 0;
        copy.rounds = copy.rounds.filter((round) => isCVReview(round) || round.publishedAt);
        const activeId = item.rounds[originalIndex]?._id?.toString();
        const activeIndex = copy.rounds.findIndex((round) => String(round._id) === activeId);
        copy.currentRound = Math.max(0, activeIndex);
        return copy;
      }) : ccas;
    const visibleUserIds = new Set(applications.map((application) => application.userId));
    const students = users.filter((entry) => role === 'senate' || visibleUserIds.has(entry._id.toString())).map((entry) => ({
      id: entry._id,
      name: entry.fullName || entry.email.split('@')[0],
      email: entry.email,
      rollNumber: entry.rollNumber,
      role: entry.role,
      ccaAssignment: entry.ccaAssignment
    }));
    const panelMembers = role === 'cca'
      ? users.filter((entry) => entry.role === 'cca' && String(entry.ccaAssignment || '') === String(ccaId)).map((entry) => ({ email: entry.email, name: entry.fullName || entry.email }))
      : [];
    if (role === 'cca' && process.env.NODE_ENV !== 'production' && isPortalAdmin && !panelMembers.some((entry) => entry.email === user.email)) panelMembers.push({ email: user.email, name: `${user.fullName || user.email} (local preview)` });
    const visible = (items) => role === 'senate'
      ? items
      : role === 'cca'
        ? items.filter((item) => item.ccaId === ccaId)
        : items.filter((item) => item.userId === user._id.toString() || item.students?.includes(user._id.toString()));
    const visiblePanelRuns = role === 'senate' ? workspace.panelRuns || [] : role === 'cca'
      ? (workspace.panelRuns || []).filter((run) => run.ccaId === ccaId)
      : (workspace.panelRuns || []).filter((run) => applications.some((application) => application.ccaId === run.ccaId));
    const panelRuns = role === 'student' ? visiblePanelRuns.map((run) => ({ ...run, students: (run.students || []).filter((entry) => String(entry.userId) === String(user._id)) })) : visiblePanelRuns;

    res.json({
      role: isPortalAdmin && process.env.NODE_ENV === 'production' && req.query.previewRole !== 'senate' ? 'admin' : role,
      isPortalAdmin,
      previewRolesEnabled: process.env.NODE_ENV !== 'production' && isPortalAdmin,
      currentUser: { id: user._id, email: user.email, name: user.fullName || user.email.split('@')[0], role: user.role },
      ccaId,
      cycle: workspace.cycle,
      stage: workspace.stage || 'applications',
      portalSchedule: workspace.portalSchedule,
      ccaControls: workspace.ccaControls || {},
      revision: workspace.revision,
      policy: workspace.policy,
      ccas: visibleCCAs,
      allCCAs: ccas.map((cca) => ({ _id: cca._id, name: cca.name })),
      students,
      panelMembers,
      applications,
      panels: visible(workspace.panels),
      panelRuns,
      sessions: visible(workspace.sessions),
      submissions: visible(workspace.submissions),
      evaluations: role === 'senate' ? workspace.evaluations : role === 'cca' ? visible(workspace.evaluations).map(({ total, score, taskScore, interviewScore, ...evaluation }) => evaluation) : [],
      exceptions: role === 'student' ? [] : visible(workspace.exceptions),
      notifications: workspace.notifications.filter((item) => role === 'senate' || (role === 'cca' && (item.ccaId === ccaId || (!item.ccaId && !item.userId))) || (role === 'student' && (item.userId === String(user._id) || (!item.userId && !item.ccaId)))),
      groups: visible(workspace.groups),
      screeningDecisions: role === 'senate' ? workspace.screeningDecisions : role === 'cca' ? visible(workspace.screeningDecisions) : [],
      markCorrections: role === 'senate' ? workspace.markCorrections : [],
      audit: role === 'senate' ? workspace.audit : role === 'student' ? workspace.audit.filter((item) => item.actor === user.email).map(({ detail, ...item }) => item) : workspace.audit.filter((item) => item.actor === user.email || item.entity === ccas.find((cca) => String(cca._id) === ccaId)?.name).map(({ detail, ...item }) => item)
    });
  } catch (error) {
    res.status(error.status || 500).json({ msg: error.message || 'Server Error' });
  }
});

const assertCCAApplicantAccess = async (req, res) => {
  const { user, role, isPortalAdmin } = await contextFor(req);
  const workspace = await workspaceFor();
  if (!['selection', 'completed'].includes(workspace.stage || 'applications')) {
    res.status(403).json({ msg: 'CV access opens when the selection workspace is open.' });
    return null;
  }
  const cca = await CCA.findById(req.params.ccaId).select('name');
  if (!cca) { res.status(404).json({ msg: 'CCA not found.' }); return null; }
  const assigned = role === 'cca' && user.ccaAssignment?.toString() === req.params.ccaId;
  const localPreview = process.env.NODE_ENV !== 'production' && isPortalAdmin && req.query.previewRole === 'cca';
  if (!(role === 'senate' || isPortalAdmin || assigned || localPreview)) {
    res.status(403).json({ msg: 'Only the assigned CCA team, Senate, or admin can access applicant CVs.' });
    return null;
  }
  return { user, role, isPortalAdmin, cca };
};

router.get('/cv/:ccaId/:userId/:cvId', auth, async (req, res) => {
  try {
    const access = await assertCCAApplicantAccess(req, res);
    if (!access) return;
    const applicant = await User.findById(req.params.userId).select('appliedCCAs cvs applicationCVs');
    if (!applicant || !applicant.appliedCCAs.some((idValue) => idValue.toString() === req.params.ccaId)) return res.status(404).json({ msg: 'Applicant or application not found.' });
    const applicationCV = (applicant.applicationCVs || []).find((entry) => entry.cca.toString() === req.params.ccaId);
    if (!applicationCV || applicationCV.cv.toString() !== req.params.cvId) return res.status(404).json({ msg: 'That CV is not attached to this application.' });
    const cv = (applicant.cvs || []).find((entry) => entry._id.toString() === req.params.cvId);
    if (!cv) return res.status(404).json({ msg: 'CV file not found.' });
    const filePath = path.join(uploadRoot, 'cvs', cv.storedFilename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ msg: 'CV file is missing from local storage.' });
    res.download(filePath, cv.filename);
  } catch (error) { res.status(error.status || 500).json({ msg: error.message || 'Could not open the CV.' }); }
});

router.get('/export/:ccaId', auth, async (req, res) => {
  try {
    const access = await assertCCAApplicantAccess(req, res);
    if (!access) return;
    const users = await User.find({ appliedCCAs: req.params.ccaId }).select('email fullName rollNumber appliedCCAs applicationCVs cvs rankedCCAs selectionApplications');
    const applications = buildApplications(users).filter((application) => application.ccaId === req.params.ccaId);
    const userById = new Map(users.map((entry) => [entry._id.toString(), entry]));
    const safeName = access.cca.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'cca';
    res.attachment(`${safeName}-applications.zip`);
    const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
    archive.on('error', (error) => { if (!res.headersSent) res.status(500).json({ msg: 'Could not create the application export.' }); else res.end(); });
    archive.pipe(res);
    const csvEscape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      ['Student', 'Email', 'Roll number', 'Vertical', 'CV filename'].map(csvEscape).join(','),
      ...applications.map((application) => [application.studentName, application.email, application.rollNumber, application.vertical, application.cvFilename || 'Not attached'].map(csvEscape).join(','))
    ].join('\n');
    archive.append(csv, { name: 'applications.csv' });
    for (const application of applications) {
      if (!application.cvId) continue;
      const applicant = userById.get(application.userId);
      const cv = applicant?.cvs?.find((entry) => entry._id.toString() === application.cvId);
      if (!cv) continue;
      const filePath = path.join(uploadRoot, 'cvs', cv.storedFilename);
      if (fs.existsSync(filePath)) archive.file(filePath, { name: `CVs/${application.studentName.replace(/[^a-z0-9]+/gi, '_')}-${cv.filename.replace(/[\\/]/g, '_')}` });
    }
    await archive.finalize();
  } catch (error) { if (!res.headersSent) res.status(error.status || 500).json({ msg: error.message || 'Could not create the application export.' }); }
});

router.get('/results-export', auth, async (req, res) => {
  try {
    const { role } = await contextFor(req);
    if (role !== 'senate') return res.status(403).json({ msg: 'Senate access required.' });
    const [workspace, ccas, users] = await Promise.all([workspaceFor(), CCA.find(), User.find({ appliedCCAs: { $exists: true, $ne: [] } })]);
    const ccaById = new Map(ccas.map((cca) => [String(cca._id), cca]));
    const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [['Student', 'Email', 'Roll number', 'Vertical', 'Preference', 'Weighted total']];
    for (const user of users) for (const application of user.selectionApplications || []) {
      const cca = ccaById.get(String(application.cca));
      if (!cca) continue;
      rows.push([user.fullName || user.email.split('@')[0], user.email, user.rollNumber, application.vertical, application.preference, cca.resultsPublished ? scoreFor(workspace, cca, String(user._id)).toFixed(2) : 'Pending ratification']);
    }
    res.type('text/csv').attachment('calvin-selection-results.csv').send(rows.map((row) => row.map(quote).join(',')).join('\r\n'));
  } catch (error) { res.status(error.status || 500).json({ msg: error.message || 'Could not export results.' }); }
});

router.get('/audit-export', auth, async (req, res) => {
  try {
    const { role } = await contextFor(req);
    if (role !== 'senate') return res.status(403).json({ msg: 'Senate or administrator access required.' });
    const workspace = await workspaceFor();
    const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Time', 'Actor', 'Role', 'Action', 'Entity', 'Detail'],
      ...workspace.audit.map((item) => [item.createdAt, item.actor, item.role, item.action, item.entity, JSON.stringify(item.detail || {})])
    ];
    res.type('text/csv').attachment('calvin-audit-trail.csv').send(rows.map((row) => row.map(quote).join(',')).join('\r\n'));
  } catch (error) { res.status(error.status || 500).json({ msg: error.message || 'Could not export the audit trail.' }); }
});

router.post('/action', auth, async (req, res) => {
  let roundEmailNotice = null;
  let actionResult = {};
  try {
    const { user, role, isPortalAdmin } = await contextFor(req);
    const workspace = await workspaceFor();
    const action = req.body.action;
    const payload = req.body.payload || {};
    const actor = user.email;
    const requireRole = (...roles) => {
      if (!roles.includes(role)) throw Object.assign(new Error(`${roles.join(' or ')} access required`), { status: 403 });
    };
    const requireStage = (...stages) => {
      const currentStage = workspace.stage || 'applications';
      if (!stages.includes(currentStage)) throw Object.assign(new Error(`This action is available only during the ${stages.join(' or ')} stage.`), { status: 403 });
    };
    const requireCCAControl = (control) => {
      if (cca && !controlEnabled(workspace, cca._id, control)) throw Object.assign(new Error(`This control is disabled for ${cca.name} by the administrator.`), { status: 403 });
    };
    const cca = payload.ccaId ? await CCA.findById(payload.ccaId) : null;
    const requireCCAAccess = (target = cca) => {
      if (!target) fail('CCA not found.', 404);
      if (!belongsToCCA(user, role, target._id) && !(process.env.NODE_ENV !== 'production' && isPortalAdmin && role === 'cca' && req.body.previewRole === 'cca')) fail('This CCA is not assigned to your account.', 403);
    };
    const requireRound = (target = cca) => {
      requireCCAAccess(target);
      const round = roundFor(target, payload.roundId);
      if (!round) fail('Round not found.', 404);
      return round;
    };

    if (action === 'setPortalStage') {
      if (!isPortalAdmin) throw Object.assign(new Error('Only the Calvin portal administrator can trigger lifecycle events.'), { status: 403 });
      const stages = ['applications', 'configuration', 'selection', 'completed'];
      if (!stages.includes(payload.stage)) return res.status(400).json({ msg: 'Choose a valid portal stage.' });
      const previousStage = workspace.stage || 'applications';
      if (payload.stage === 'selection') {
        const configuredCCAs = await CCA.find({ selectionStatus: { $in: ['Draft', 'Finalized'] } });
        for (const configuredCCA of configuredCCAs) {
          const reviewRound = ensureCVReviewRound(configuredCCA);
          const firstScoredRound = configuredCCA.rounds.find((round) => !isCVReview(round));
          if (configuredCCA.selectionStatus === 'Finalized' && reviewRound.status === 'Draft') {
            reviewRound.status = 'Active';
            reviewRound.startedAt = new Date();
          }
          await configuredCCA.save();
        }
      }
      workspace.stage = payload.stage;
      workspace.markModified('stage');
      addAudit(workspace, actor, role, 'Portal stage changed', payload.stage, { from: previousStage, to: payload.stage });
      addNotification(workspace, `Calvin is now in ${payload.stage} stage`);
    } else if (action === 'updatePortalSchedule') {
      if (!isPortalAdmin) throw Object.assign(new Error('Only the Calvin portal administrator can set lifecycle timings.'), { status: 403 });
      const schedule = {};
      for (const stage of ['applications', 'configuration', 'selection']) {
        const window = payload.schedule?.[stage] || {};
        const startDate = window.start ? new Date(window.start) : null;
        const endDate = window.end ? new Date(window.end) : null;
        const start = startDate && !Number.isNaN(startDate.getTime()) ? startDate.toISOString() : null;
        const end = endDate && !Number.isNaN(endDate.getTime()) ? endDate.toISOString() : null;
        schedule[stage] = { start, end, enabled: payload.flags?.[stage]?.enabled !== undefined ? Boolean(payload.flags[stage].enabled) : workspace.portalSchedule?.[stage]?.enabled ?? stage === workspace.stage };
      }
      workspace.portalSchedule = schedule;
      workspace.markModified('portalSchedule');
      addAudit(workspace, actor, role, 'Portal event flags updated', 'portal-schedule', schedule);
      addNotification(workspace, 'Portal event flags and lifecycle timings were updated by the administrator.');
    } else if (action === 'setCCAControl') {
      if (!isPortalAdmin) throw Object.assign(new Error('Only the Calvin portal administrator can change control levels.'), { status: 403 });
      if (!cca) return res.status(404).json({ msg: 'CCA not found.' });
      const controls = ['tasks', 'interviews', 'evaluations', 'results'];
      if (!controls.includes(payload.control)) return res.status(400).json({ msg: 'Choose a valid control.' });
      workspace.ccaControls = workspace.ccaControls || {};
      workspace.ccaControls[cca._id.toString()] = { ...(workspace.ccaControls[cca._id.toString()] || {}), [payload.control]: Boolean(payload.enabled) };
      workspace.markModified('ccaControls');
      addAudit(workspace, actor, role, `CCA control ${payload.enabled ? 'enabled' : 'disabled'}`, cca.name, { control: payload.control });
      addNotification(workspace, `${payload.control} ${payload.enabled ? 'enabled' : 'disabled'} · ${cca.name}`);
    } else if (action === 'updatePolicy') {
      requireRole('senate');
      const multiplier = payload.multiplier === null ? null : Number(payload.multiplier);
      if (multiplier !== null && (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 10)) return res.status(400).json({ msg: 'Multiplier must be between 1 and 10.' });
      const tieBreaker = payload.tieBreaker || workspace.policy?.tieBreaker || 'finalRound';
      if (!['finalRound', 'earliestApplication'].includes(tieBreaker)) fail('Choose a supported tie-break rule.');
      if (workspace.stage === 'selection' && tieBreaker !== (workspace.policy?.tieBreaker || 'finalRound')) fail('Tie-break rules cannot change after selection starts.', 409);
      workspace.policy = { multiplier, decimals: Boolean(payload.decimals), tieBreaker, version: Number(workspace.policy?.version || 0) + 1 };
      addAudit(workspace, actor, role, 'Policy updated', 'selection-policy', workspace.policy);
    } else if (action === 'addScoredRound' || action === 'editScoredRound' || action === 'publishRound') {
      requireRole('cca');
      requireStage('applications', 'configuration', 'selection');
      requireCCAAccess();
      if (cca.resultsPublished || !['Draft', 'Finalized', 'Locked'].includes(cca.selectionStatus)) fail('Rounds can no longer be changed for this CCA.', 409);
      const round = action === 'addScoredRound' ? null : requireRound();
      if (action === 'addScoredRound') requireStage('applications', 'configuration');
      if (action === 'addScoredRound' && cca.selectionStatus !== 'Draft') fail('Rounds can only be added during round building.', 409);
      if (round && (round.status === 'Completed' || (round.startAt ? Date.now() >= Date.parse(round.startAt) : round.status === 'Active'))) fail('Round details can only be changed before the scheduled start.', 409);
      if (action === 'publishRound') {
        requireStage('selection');
        if (round.publishedAt) fail('This round is already published.', 409);
        if (!round.startAt) fail('Set a scheduled start time before publishing this round.');
        round.publishedAt = new Date();
        round.status = round.status === 'Draft' ? 'Published' : round.status;
        addAudit(workspace, actor, role, 'Round published', cca.name, { roundId: String(round._id), round: round.name });
        addNotification(workspace, `${round.name} published by ${actor} · ${cca.name}`, null, String(cca._id));
        const students = await User.find({ appliedCCAs: cca._id }).select('_id email fullName selectionApplications');
        for (const student of students.filter((entry) => isActiveApplication(entry, cca._id))) addNotification(workspace, `${round.name} published · ${cca.name}`, String(student._id), String(cca._id));
        roundEmailNotice = { cca, round, students, subject: `${cca.name}: ${round.name} is published`, kind: 'published' };
      } else {
        const value = payload.round || payload;
        const next = {
          name: String(value.name || '').trim(), type: value.type || 'Individual · Task', maxMarks: Number(value.maxMarks),
          taskMaxMarks: Number(value.taskMaxMarks ?? (String(value.type).includes('Task') && !String(value.type).includes('Interview') ? value.maxMarks : 0)),
          interviewMaxMarks: Number(value.interviewMaxMarks ?? (String(value.type).includes('Interview') && !String(value.type).includes('Task') ? value.maxMarks : 0)),
          weight: Number(value.weight), deadline: value.deadline || null,
          startAt: value.startAt || null, instructions: String(value.instructions || ''), criteria: String(value.criteria || '')
        };
        next.documents = Array.isArray(value.documents) ? value.documents.map((document) => ({ name: String(document.name || '').trim(), fileKey: String(document.fileKey || '') })).filter((document) => document.name && /^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(document.fileKey) && fs.existsSync(path.join(roundUploadRoot, document.fileKey))) : [];
        if (!next.name || !roundTypes.has(next.type) || !Number.isFinite(next.maxMarks) || next.maxMarks < 1 || !Number.isFinite(next.weight) || next.weight < 1 || (next.startAt && Number.isNaN(Date.parse(next.startAt))) || (next.deadline && Number.isNaN(Date.parse(next.deadline)))) fail('Add a name, valid round format, positive marks and weight, and valid dates.');
        if (next.startAt && next.deadline && new Date(next.deadline) < new Date(next.startAt)) fail('The deadline must be after the scheduled start.');
        if (next.deadline && new Date(next.deadline) < new Date(next.startAt)) fail('The deadline must be after the scheduled start.');
        if (isTask({ type: next.type }) && isInterview({ type: next.type }) && (next.taskMaxMarks <= 0 || next.interviewMaxMarks <= 0 || next.taskMaxMarks + next.interviewMaxMarks !== next.maxMarks)) fail('Task and interview marks must add up to the round maximum.');
        if (round && !isInterview({ type: next.type }) && workspace.panels.some((panel) => panel.ccaId === String(cca._id) && panel.roundId === String(round._id))) fail('Remove this round\'s panels before changing it to a non-interview format.');
        if (action === 'addScoredRound') {
          const doc = cca.rounds.create({ ...next, status: 'Draft', policyVersion: workspace.policy.version, poolMultiplier: workspace.policy.multiplier });
          cca.rounds.push(doc);
          addAudit(workspace, actor, role, 'Round added', cca.name, { roundId: String(doc._id), round: doc.name });
        } else {
          const wasPublished = Boolean(round.publishedAt);
          if (cca.selectionStatus === 'Draft') Object.assign(round, next);
          else {
            round.startAt = next.startAt;
            round.deadline = next.deadline;
            round.instructions = next.instructions;
            round.documents = next.documents;
          }
          addAudit(workspace, actor, role, wasPublished ? 'Published round changed' : 'Round edited', cca.name, { roundId: String(round._id), round: round.name });
          if (wasPublished) {
            const students = await User.find({ appliedCCAs: cca._id }).select('_id email fullName selectionApplications');
            for (const student of students.filter((entry) => isActiveApplication(entry, cca._id))) addNotification(workspace, `${round.name} updated · ${cca.name}`, String(student._id), String(cca._id));
            roundEmailNotice = { cca, round, students, subject: `${cca.name}: ${round.name} has been updated` };
          }
        }
        addNotification(workspace, `Round structure changed by ${actor} · ${cca.name}`, null, String(cca._id));
      }
      await cca.save();
    } else if (action === 'configureCCA') {
      requireRole('cca');
      requireStage('applications', 'configuration');
      requireCCAAccess();
      if (!['Draft', 'Finalized'].includes(cca.selectionStatus) || cca.rounds.some((round) => round.status !== 'Draft')) fail('Only an unstarted selection structure can be changed during internal setup.', 409);
      const seats = Number(payload.seats);
      const constitutionalStrength = Number(payload.constitutionalStrength || seats);
      if (!Number.isInteger(constitutionalStrength) || constitutionalStrength < 1) fail('CCA constitutional strength must be a positive whole number.');
      const verticals = (payload.verticals || []).map((item) => ({ name: String(item.name || '').trim(), seats: Number(item.seats) }));
      if (!Number.isInteger(seats) || seats < 1 || !verticals.length || verticals.some((item) => !item.name || !Number.isInteger(item.seats) || item.seats < 1) || verticals.reduce((sum, item) => sum + item.seats, 0) !== seats) {
        return res.status(400).json({ msg: 'Vertical seats must be positive and add up to total seats.' });
      }
      if (new Set(verticals.map((item) => item.name.toLowerCase())).size !== verticals.length) fail('Vertical names must be unique.');
      if (cca.selectionStatus === 'Finalized') {
        const sameVerticals = seats === cca.seats
          && constitutionalStrength === Number(cca.constitutionalStrength || cca.seats)
          && verticals.length === cca.verticals.length
          && verticals.every((vertical, index) => vertical.name === cca.verticals[index].name && vertical.seats === cca.verticals[index].seats);
        if (!sameVerticals) fail('Total seats, constitutional strength, and finalized vertical names and seats are locked. Only rounds can be changed.', 409);
      }
      cca.seats = cca.selectionStatus === 'Draft' ? seats : cca.seats;
      cca.constitutionalStrength = cca.selectionStatus === 'Draft' ? constitutionalStrength : cca.constitutionalStrength;
      cca.contactPerson = String(payload.contactPerson || '').trim();
      cca.selectionCoordinators = String(payload.selectionCoordinators || '').split('\n').map((entry) => entry.trim()).filter(Boolean);
      if (String(payload.description || '').trim()) cca.description = String(payload.description).trim();
      if (cca.selectionStatus === 'Draft') cca.verticals = verticals;
      // Round configuration is managed separately from seats and verticals.
      cca.applicationDeadline = payload.applicationDeadline || null;
      if (cca.selectionStatus === 'Draft') cca.selectionStatus = 'Draft';
      cca.currentRound = 0;
      cca.resultsPublished = false;
      await cca.save();
      addAudit(workspace, actor, role, 'CCA configured', cca.name, { seats, verticals, rounds: rounds.length });
    } else if (action === 'setCCAStatus') {
      requireRole('cca');
      requireStage('applications', 'configuration', 'selection');
      requireCCAAccess();
      const transitions = { Draft: ['Finalized'], Finalized: ['Locked'] };
      if (!transitions[cca.selectionStatus]?.includes(payload.status)) fail('This selection status cannot be changed manually.');
      if (payload.status === 'Finalized' && (!cca.seats || !cca.verticals.length || !cca.rounds.length)) fail('Set seats, verticals, and rounds before finalizing.');
      if (payload.status === 'Finalized') {
        const reviewRound = ensureCVReviewRound(cca);
        const firstScoredRound = cca.rounds.find((round) => !isCVReview(round));
        if (workspace.stage === 'selection' && reviewRound.status === 'Draft') { reviewRound.status = 'Active'; reviewRound.startedAt = new Date(); }
      }
      if (payload.status === 'Locked') {
        requireStage('selection');
        const reviewRound = cca.rounds.find(isCVReview);
        const firstScoredRound = cca.rounds.find((round) => !isCVReview(round));
        if (!reviewRound || reviewRound.status !== 'Active') fail('Round 0 CV review must be open before starting Round 1.');
        if (!firstScoredRound) fail('Configure at least one scored round after CV review.');
        if (cca.rounds.filter((round) => !isCVReview(round) && isInterview(round)).some((round) => !workspace.panels.some((panel) => panel.ccaId === String(cca._id) && panel.roundId === String(round._id)))) fail('Configure at least one panel for every interview round before starting Round 1.');
        const applicants = await User.find({ appliedCCAs: cca._id }).select('selectionApplications');
        const verticalNames = new Set(cca.verticals.map((item) => item.name));
        if (applicants.some((entry) => !verticalNames.has(entry.selectionApplications.find((item) => String(item.cca) === String(cca._id))?.vertical))) fail('Every applicant must choose an available vertical before the first round starts.');
        reviewRound.status = 'Completed';
        reviewRound.completedAt = new Date();
        firstScoredRound.status = 'Active';
        firstScoredRound.startedAt = new Date();
        firstScoredRound.policyVersion = workspace.policy.version;
        firstScoredRound.poolMultiplier = workspace.policy.multiplier;
        cca.currentRound = cca.rounds.findIndex((round) => String(round._id) === String(firstScoredRound._id));
        for (const applicant of applicants) addNotification(workspace, `${firstScoredRound.name} opened · ${cca.name}${isTask(firstScoredRound) ? ' · Task assigned' : ''}`, String(applicant._id), String(cca._id));
      }
      cca.selectionStatus = payload.status;
      await cca.save();
      addAudit(workspace, actor, role, `CCA status: ${payload.status}`, cca.name);
    } else if (action === 'createPanel') {
      requireRole('cca');
      requireStage('applications', 'configuration', 'selection');
      const round = requireRound();
      if (isCVReview(round) || !isInterview(round)) fail('Create panels only for Individual or Group Interview and Task + Interview rounds.');
      if (cca.resultsPublished || round.status === 'Completed') fail('Panels cannot be created after this round is completed.', 409);
      const members = (payload.members || []).map(String).map((entry) => entry.trim()).filter(Boolean);
      if (!members.length) return res.status(400).json({ msg: 'Add at least one panel member.' });
      if (new Set(members.map((entry) => entry.toLowerCase())).size !== members.length) fail('A panel member can only be added once.');
      const validMembers = await User.find({ email: { $in: members }, role: 'cca', ccaAssignment: cca._id }).select('email');
      const permittedEmails = new Set(validMembers.map((entry) => entry.email.toLowerCase()));
      if (process.env.NODE_ENV !== 'production' && isPortalAdmin && role === 'cca') permittedEmails.add(user.email.toLowerCase());
      if (members.some((entry) => !permittedEmails.has(entry.toLowerCase()))) fail('Choose panel members from this CCA\'s registered PGP accounts.');
      workspace.panels.push({ id: id(), ccaId: cca._id.toString(), roundId: String(round._id), name: payload.name || `Panel ${workspace.panels.length + 1}`, members, students: [], locked: false, createdAt: now() });
      addAudit(workspace, actor, role, 'Panel created', cca.name, { members: members.length });
    } else if (action === 'editPanel') {
      requireRole('cca');
      requireStage('applications', 'configuration', 'selection');
      requireCCAAccess();
      const panel = workspace.panels.find((item) => item.id === payload.panelId && item.ccaId === String(cca._id));
      const round = panel && roundFor(cca, panel.roundId);
      if (panel && round && !isInterview(round)) fail('Panels can only be edited for Individual or Group Interview and Task + Interview rounds.');
      if (!panel || !round || panel.locked || round.status === 'Completed' || (workspace.panelRuns || []).some((run) => run.panelId === panel.id)) fail('A panel can only be edited before it starts.', 409);
      const members = [...new Set((payload.members || []).map(String).map((entry) => entry.trim()).filter(Boolean))];
      if (!members.length) fail('Add at least one panel member.');
      const validMembers = await User.find({ email: { $in: members }, role: 'cca', ccaAssignment: cca._id }).select('email');
      const permittedEmails = new Set(validMembers.map((entry) => entry.email.toLowerCase()));
      if (process.env.NODE_ENV !== 'production' && isPortalAdmin && role === 'cca') permittedEmails.add(user.email.toLowerCase());
      if (members.some((entry) => !permittedEmails.has(entry.toLowerCase()))) fail('Choose panel members from this CCA\'s registered PGP accounts.');
      panel.name = String(payload.name || '').trim() || panel.name;
      panel.members = members;
      addAudit(workspace, actor, role, 'Panel updated', cca.name, { panelId: panel.id, members: members.length });
    } else if (action === 'deletePanel') {
      requireRole('cca');
      requireStage('applications', 'configuration', 'selection');
      requireCCAAccess();
      const panelIndex = workspace.panels.findIndex((item) => item.id === payload.panelId && item.ccaId === String(cca._id));
      const panel = workspace.panels[panelIndex];
      if (!panel || panel.locked || (workspace.panelRuns || []).some((run) => run.panelId === panel.id)) fail('A panel can only be deleted before it starts.', 409);
      workspace.panels.splice(panelIndex, 1);
      addAudit(workspace, actor, role, 'Panel deleted', cca.name, { panelId: panel.id, panel: panel.name });
    } else if (action === 'assignPanelStudents') {
      requireRole('cca');
      requireStage('configuration', 'selection');
      requireCCAAccess();
      const panel = workspace.panels.find((item) => item.id === payload.panelId && item.ccaId === String(cca._id));
      const round = panel && roundFor(cca, panel.roundId);
      if (round && !isInterview(round)) fail('Only interview rounds can have panels or panel assignments.');
      if (!panel || !round || panel.locked || round.status === 'Completed') fail('Panel assignments are locked.', 409);
      const studentIds = [...new Set((payload.students || []).map(String))];
      if (!studentIds.length) fail('Assign at least one student.');
      if (workspace.panels.some((item) => item.id !== panel.id && item.roundId === panel.roundId && item.students?.some((student) => studentIds.includes(student)))) fail('A student is already assigned to another panel for this round.', 409);
      const applicants = await User.find({ _id: { $in: studentIds } });
      if (applicants.length !== studentIds.length || applicants.some((entry) => !isActiveApplication(entry, cca._id))) fail('Only active applicants can be assigned to panels.');
      panel.students = studentIds;
      addAudit(workspace, actor, role, 'Panel students assigned', cca.name, { panelId: panel.id, count: studentIds.length });
    } else if (action === 'startPanelRun') {
      requireRole('cca');
      requireStage('selection');
      requireCCAAccess();
      const round = requireRound();
      requireCCAControl('interviews');
      const panel = workspace.panels.find((item) => item.id === payload.panelId && item.ccaId === String(cca._id) && item.roundId === String(round._id));
      if (!panel || isCVReview(round) || !isInterview(round) || round.status !== 'Active') fail('Start a panel only for the active interview round.');
      if (!round.startAt || Date.now() < Date.parse(round.startAt)) fail('This panel opens at the scheduled round start.');
      if (!panel.members.includes(user.email)) fail('Only a member of this panel can start it.', 403);
      if ((workspace.panelRuns || []).some((run) => run.panelId === panel.id && run.status === 'Active')) fail('This panel already has an active run.', 409);
      const lateMinutes = Number(payload.lateMinutes || 0);
      if (!Number.isInteger(lateMinutes) || lateMinutes < 0 || lateMinutes > 240) fail('Enter a delay between 0 and 240 minutes.');
      const run = { id: id(), ccaId: String(cca._id), roundId: String(round._id), panelId: panel.id, panelName: panel.name, roundName: round.name, status: 'Active', startedAt: now(), lateMinutes, startedBy: actor, students: [] };
      panel.locked = true;
      workspace.panelRuns.push(run);
      const applicants = await User.find({ appliedCCAs: cca._id }).select('_id selectionApplications');
      for (const applicant of applicants.filter((entry) => isActiveApplication(entry, cca._id))) addNotification(workspace, `${round.name} has started · ${panel.name} · ${cca.name}`, String(applicant._id), String(cca._id));
      addAudit(workspace, actor, role, 'Panel started', cca.name, { panelId: panel.id, panelRunId: run.id, round: round.name, lateMinutes });
      actionResult = { panelRunId: run.id };
    } else if (action === 'panelAttendance') {
      const transition = payload.transition;
      if (transition === 'studentIn' || transition === 'studentOut') requireRole('student'); else requireRole('cca');
      requireStage('selection');
      const run = (workspace.panelRuns || []).find((item) => item.id === payload.panelRunId && item.status === 'Active');
      if (!run) fail('This panel run is not active.', 404);
      const runCCA = await CCA.findById(run.ccaId);
      if (!runCCA) fail('CCA not found.', 404);
      const panel = workspace.panels.find((item) => item.id === run.panelId);
      if (role === 'student') {
        if (!isActiveApplication(user, run.ccaId)) fail('Only an active applicant can check in.', 403);
        payload.userId = String(user._id);
      } else {
        requireCCAAccess(runCCA);
        if (!controlEnabled(workspace, runCCA._id, 'interviews')) fail(`Interviews are disabled for ${runCCA.name} by the administrator.`, 403);
        if (!panel?.members.includes(user.email)) fail('Only a member of this panel can record attendance.', 403);
      }
      const candidate = await User.findById(payload.userId).select('_id fullName email selectionApplications');
      if (!candidate || !isActiveApplication(candidate, run.ccaId)) fail('Choose an active applicant for this CCA.');
      let attendance = panelRunStudent(run, candidate._id);
      if (transition === 'ccaIn') {
        if (attendance) fail('This student already has an attendance record for the panel.', 409);
        const alreadyEvaluated = workspace.evaluations.some((entry) => entry.ccaId === run.ccaId && entry.roundId === run.roundId && String(entry.userId) === String(candidate._id)) || workspace.screeningDecisions.some((entry) => entry.ccaId === run.ccaId && entry.roundId === run.roundId && String(entry.userId) === String(candidate._id));
        const alreadyAssignedThisRound = (workspace.panelRuns || []).some((other) => other.ccaId === run.ccaId && other.roundId === run.roundId && panelRunStudent(other, candidate._id));
        if (alreadyEvaluated || alreadyAssignedThisRound) fail('This applicant has already completed or been called into a panel for this round.', 409);
        const alreadyIn = (workspace.panelRuns || []).some((other) => other.id !== run.id && other.status === 'Active' && panelRunStudent(other, candidate._id)?.ccaInAt && !panelRunStudent(other, candidate._id)?.studentOutAt);
        if (alreadyIn) fail('This student is already checked in to another active panel.', 409);
        attendance = { userId: String(candidate._id), studentName: candidate.fullName || candidate.email.split('@')[0], ccaInAt: now(), studentInAt: null, ccaOutAt: null, studentOutAt: null, scoreDueAt: null, evaluationId: null, scoreEditUntil: null };
        run.students.push(attendance);
        addNotification(workspace, `${run.roundName} panel started · Please confirm your attendance at ${run.panelName}.`, String(candidate._id), run.ccaId);
        addAudit(workspace, actor, role, 'CCA marked student present', runCCA.name, { panelRunId: run.id, userId: attendance.userId, round: run.roundName });
      } else {
        if (!attendance) fail('The CCA has not marked you in for this panel.', 403);
        if (transition === 'studentIn') {
          if (attendance.studentInAt) fail('Your attendance is already confirmed.');
          const alreadyIn = (workspace.panelRuns || []).some((other) => other.status === 'Active' && panelRunStudent(other, candidate._id)?.studentInAt && !panelRunStudent(other, candidate._id)?.studentOutAt);
          if (alreadyIn) fail('You are already checked in to another active panel.', 409);
          attendance.studentInAt = now();
          addAudit(workspace, actor, role, 'Student confirmed attendance', runCCA.name, { panelRunId: run.id, round: run.roundName });
        } else if (transition === 'ccaOut') {
          if (!attendance.studentInAt || attendance.ccaOutAt) fail('The student must confirm arrival before the CCA can mark them out.');
          attendance.ccaOutAt = now();
          attendance.scoreDueAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
          addNotification(workspace, `${run.roundName} interview complete · Please mark your attendance out.`, String(candidate._id), run.ccaId);
          addAudit(workspace, actor, role, 'CCA marked student out', runCCA.name, { panelRunId: run.id, userId: attendance.userId, round: run.roundName, marksDueAt: attendance.scoreDueAt });
          actionResult = { openScoreEntry: { ccaId: run.ccaId, panelRunId: run.id, panelId: run.panelId, roundId: run.roundId, userId: attendance.userId, studentName: attendance.studentName, scoreDueAt: attendance.scoreDueAt } };
        } else if (transition === 'studentOut') {
          if (!attendance.studentInAt || attendance.studentOutAt) fail('Confirm your arrival first, then mark out once.');
          attendance.studentOutAt = now();
          addAudit(workspace, actor, role, 'Student marked attendance out', runCCA.name, { panelRunId: run.id, round: run.roundName });
        } else fail('Unknown panel attendance action.');
      }
      if (run.students.length && run.students.every((item) => item.evaluationId && item.ccaOutAt && item.studentOutAt)) run.allStudentsCompleteAt = now();
    } else if (action === 'finishPanelRun') {
      requireRole('cca');
      requireStage('selection');
      const run = (workspace.panelRuns || []).find((item) => item.id === payload.panelRunId && item.status === 'Active');
      if (!run) fail('This panel run is not active.', 404);
      const runCCA = await CCA.findById(run.ccaId);
      requireCCAAccess(runCCA);
      if (!controlEnabled(workspace, runCCA._id, 'interviews')) fail(`Interviews are disabled for ${runCCA.name} by the administrator.`, 403);
      const panel = workspace.panels.find((item) => item.id === run.panelId);
      if (!panel?.members.includes(user.email)) fail('Only a member of this panel can sign out.', 403);
      if (!run.students.length) fail('Check in at least one student before signing out the panel.');
      const missingMarks = run.students.filter((item) => item.ccaOutAt && !item.evaluationId);
      const missingStudentOut = run.students.filter((item) => item.ccaOutAt && !item.studentOutAt);
      for (const item of missingMarks) if (Date.now() >= Date.parse(item.scoreDueAt)) addPanelException(workspace, run, item.userId, 'missingPanelMarks', `Marks were not submitted within 10 minutes after CCA checkout for ${item.studentName}.`);
      for (const item of missingStudentOut) addPanelException(workspace, run, item.userId, 'missingStudentCheckout', `${item.studentName} did not confirm attendance out before the panel signed out.`);
      if (missingMarks.length || missingStudentOut.length || run.students.some((item) => !item.ccaOutAt || !item.evaluationId || !item.studentOutAt)) {
        workspace.markModified('exceptions');
        if (missingMarks.length || missingStudentOut.length) await workspace.save();
        if (missingMarks.length) fail('Every student needs a score before the panel can sign out. Missing marks have been flagged to Senate when their 10-minute window expired.', 409);
        if (missingStudentOut.length) fail('Every student must confirm attendance out. Missing check-outs have been flagged to Senate.', 409);
        fail('Finish attendance and enter every score before the panel signs out.', 409);
      }
      run.status = 'Completed';
      run.endedAt = now();
      addAudit(workspace, actor, role, 'Panel signed out', runCCA.name, { panelId: panel.id, panelRunId: run.id, round: run.roundName, students: run.students.length });
    } else if (action === 'savePanelMarks' || action === 'editPanelMarks') {
      requireRole('cca');
      requireStage('selection');
      const run = (workspace.panelRuns || []).find((item) => item.id === payload.panelRunId && item.status === 'Active');
      if (!run) fail('This panel run is no longer active.', 404);
      const runCCA = await CCA.findById(run.ccaId);
      requireCCAAccess(runCCA);
      if (!controlEnabled(workspace, runCCA._id, 'interviews')) fail(`Interviews are disabled for ${runCCA.name} by the administrator.`, 403);
      const panel = workspace.panels.find((item) => item.id === run.panelId);
      if (!panel?.members.includes(user.email)) fail('Only a member of this panel can enter marks.', 403);
      const round = roundFor(runCCA, run.roundId);
      const attendance = panelRunStudent(run, payload.userId);
      if (!round || !attendance?.ccaOutAt) fail('Mark the student out with the CCA before entering marks.');
      if (action === 'savePanelMarks' && Date.now() > Date.parse(attendance.scoreDueAt)) fail('The 10-minute score entry window has closed. Senate has been notified.');
      const evaluation = attendance.evaluationId && workspace.evaluations.find((item) => item.id === attendance.evaluationId);
      if (action === 'savePanelMarks' && evaluation) fail('Marks have already been submitted.', 409);
      if (action === 'editPanelMarks' && (!evaluation || !attendance.scoreEditUntil || Date.now() > Date.parse(attendance.scoreEditUntil))) fail('The two-minute score correction window has closed.', 409);
      const total = Number(payload.total);
      if (!Number.isFinite(total) || total < 0 || total > round.maxMarks || (!workspace.policy.decimals && !Number.isInteger(total))) fail(`Enter a score between 0 and ${round.maxMarks}.`);
      let taskScore = null;
      let interviewScore = null;
      if (isTask(round) && isInterview(round) && round.taskMaxMarks > 0 && round.interviewMaxMarks > 0) {
        taskScore = Number(payload.taskScore);
        interviewScore = Number(payload.interviewScore);
        if (!Number.isFinite(taskScore) || !Number.isFinite(interviewScore) || taskScore < 0 || interviewScore < 0 || taskScore > round.taskMaxMarks || interviewScore > round.interviewMaxMarks || taskScore + interviewScore !== total) fail('Task and interview marks must be within their maximums and add up to the total.');
      } else if (isTask(round) && !isInterview(round)) taskScore = total;
      else if (isInterview(round) && !isTask(round)) interviewScore = total;
      if (evaluation) {
        evaluation.total = total;
        evaluation.taskScore = taskScore;
        evaluation.interviewScore = interviewScore;
        evaluation.lastEditedAt = now();
        addAudit(workspace, actor, role, 'Panel marks edited', runCCA.name, { panelRunId: run.id, round: round.name, userId: attendance.userId });
      } else {
        const evaluationId = id();
        const enteredAt = now();
        attendance.evaluationId = evaluationId;
        attendance.scoreEnteredAt = enteredAt;
        attendance.scoreEditUntil = new Date(Date.now() + 2 * 60 * 1000).toISOString();
        workspace.evaluations.push({ id: evaluationId, ccaId: run.ccaId, roundId: run.roundId, userId: attendance.userId, panelId: panel.id, total, taskScore, interviewScore, maxMarks: round.maxMarks, locked: true, actor, createdAt: enteredAt, scoreEditUntil: attendance.scoreEditUntil, panelRunId: run.id });
        addAudit(workspace, actor, role, 'Panel marks submitted', runCCA.name, { panelRunId: run.id, round: round.name, userId: attendance.userId, editUntil: attendance.scoreEditUntil });
      }
      if (run.students.every((item) => item.evaluationId && item.ccaOutAt && item.studentOutAt)) run.allStudentsCompleteAt = now();
    } else if (action === 'scheduleInterview') {
      requireRole('cca');
      requireStage('selection');
      const round = requireRound();
      requireCCAControl('interviews');
      if (!payload.panelId || !payload.time || !payload.location || !(payload.students || []).length) return res.status(400).json({ msg: 'Choose a panel, students, time and location.' });
      if (round.status !== 'Active' || !isInterview(round)) fail('Schedule interviews only in an active interview round.');
      if (isScreening(round) && payload.students.length !== 1) fail('Round 0 interviews are individual.');
      const panel = workspace.panels.find((item) => item.id === payload.panelId && item.ccaId === String(cca._id) && item.roundId === String(round._id));
      if (!panel) fail('Choose a panel assigned to this round.');
      if (payload.students.some((student) => !panel.students?.includes(student))) fail('Assign every interview participant to this panel first.');
      if (role === 'cca' && !panel.members.includes(user.email)) fail('Only a member of this panel may schedule its interviews.', 403);
      const participants = await User.find({ _id: { $in: payload.students } });
      if (participants.length !== new Set(payload.students).size || participants.some((entry) => !isActiveApplication(entry, cca._id))) fail('All interview participants must be active applicants.');
      const timestamp = Date.parse(payload.time);
      if (!Number.isFinite(timestamp)) fail('Choose a valid interview time.');
      const conflict = workspace.sessions.some((session) => Math.abs(Date.parse(session.time) - timestamp) < 30 * 60 * 1000 && (session.panelId === payload.panelId || session.students.some((student) => payload.students.includes(student))));
      if (conflict) return res.status(400).json({ msg: 'This slot conflicts with another student or panel interview.' });
      const session = { id: id(), ccaId: cca._id.toString(), roundId: payload.roundId, panelId: payload.panelId, students: payload.students, time: payload.time, location: payload.location, status: 'Scheduled', entered: [], exited: [], events: [] };
      workspace.sessions.push(session);
      for (const student of payload.students) addNotification(workspace, `Interview scheduled · ${cca.name}`, student, cca._id.toString());
      addAudit(workspace, actor, role, 'Interview scheduled', cca.name, { session: session.id });
    } else if (action === 'transitionSession') {
      requireStage('selection');
      const session = workspace.sessions.find((item) => item.id === payload.sessionId);
      if (!session) return res.status(404).json({ msg: 'Interview not found.' });
      const sessionCCA = await CCA.findById(session.ccaId);
      if (sessionCCA && !controlEnabled(workspace, sessionCCA._id, 'interviews')) throw Object.assign(new Error(`Interviews are disabled for ${sessionCCA.name} by the administrator.`), { status: 403 });
      const transition = payload.transition;
      if (transition === 'studentEnter' || transition === 'studentExit') requireRole('student'); else requireRole('cca');
      if (role === 'student' && !session.students.includes(String(user._id))) fail('You are not assigned to this interview.', 403);
      if (role !== 'student') {
        requireCCAAccess(sessionCCA);
        const panel = workspace.panels.find((item) => item.id === session.panelId);
        if (role === 'cca' && !panel?.members.includes(user.email)) fail('You are not a member of this interview panel.', 403);
      }
      if ((transition === 'studentEnter' || transition === 'studentExit') && (workspace.stage || 'applications') !== 'selection') return res.status(403).json({ msg: 'The selection workspace is not open to students yet.' });
      if (transition === 'studentEnter') {
        if (!['Scheduled', 'Waiting for panel', 'Waiting for student'].includes(session.status)) fail('Interview is not ready.');
        session.entered = [...new Set([...(session.entered || []), String(user._id)])];
        session.status = session.panelEntered ? 'Active' : 'Waiting for panel';
      }
      if (transition === 'panelEnter') {
        if (!['Scheduled', 'Waiting for panel'].includes(session.status)) fail('Panel cannot enter at this stage.');
        if (workspace.sessions.some((item) => item.id !== session.id && item.panelId === session.panelId && ['Waiting for student', 'Waiting for panel', 'Active', 'Evaluation pending', 'Marks locked'].includes(item.status))) fail('This panel must finish and exit its current interview before starting another.', 409);
        session.panelEntered = true;
        session.status = session.entered?.length ? 'Active' : 'Waiting for student';
      }
      if (transition === 'studentExit') {
        if (session.status !== 'Active' || !session.entered?.includes(String(user._id))) fail('Enter the active interview before completing it.');
        session.exited = [...new Set([...(session.exited || []), String(user._id)])];
        if (session.exited.length >= session.students.length) session.status = 'Evaluation pending';
      }
      if (transition === 'panelExit') { if (session.status !== 'Marks locked') fail('Lock evaluations first.'); session.status = 'Completed'; }
      if (!['studentEnter', 'studentExit', 'panelEnter', 'panelExit'].includes(transition)) fail('Unknown interview transition.');
      session.events = [...(session.events || []), { action: transition, at: now() }];
      for (const student of session.students) addNotification(workspace, `Interview ${session.status.toLowerCase()} · ${sessionCCA?.name || 'CCA'}`, student, session.ccaId);
      addAudit(workspace, actor, role, `Interview ${transition}`, session.id);
    } else if (action === 'submitTask') {
      requireRole('student');
      requireStage('selection');
      if (!cca) fail('CCA not found.', 404);
      const round = roundFor(cca, payload.roundId);
      if (!round || round.status !== 'Active' || !isTask(round)) fail('This task round is not active.');
      if (!isActiveApplication(user, cca._id)) fail('Only active applicants can submit this task.', 403);
      if (!controlEnabled(workspace, payload.ccaId, 'tasks')) fail('Task submissions are currently disabled for this CCA.', 403);
      if (!payload.roundId || !payload.ccaId || (!payload.url && !payload.fileKey)) return res.status(400).json({ msg: 'Add a submission link or upload a file.' });
      if (payload.url && !/^https:\/\//i.test(payload.url)) fail('Task links must use HTTPS.');
      if (payload.fileKey && (!/^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(payload.fileKey) || !fs.existsSync(path.join(taskUploadRoot, String(user._id), payload.fileKey)))) fail('Upload the task file from your own account first.');
      if (workspace.submissions.some((item) => item.roundId === payload.roundId && item.userId === user._id.toString())) return res.status(409).json({ msg: 'A submission is already recorded for this round.' });
      let students = [String(user._id)];
      let groupId = null;
      if (String(round.type).startsWith('Group')) {
        const group = workspace.groups.find((item) => item.ccaId === String(cca._id) && item.roundId === String(round._id) && item.students.includes(String(user._id)));
        if (!group) fail('Your group has not been assigned for this round.');
        students = group.students;
        groupId = group.id;
      }
      if (workspace.submissions.some((item) => item.roundId === String(round._id) && item.students?.some((student) => students.includes(student)))) fail('A submission is already recorded for this student or group.', 409);
      const submittedAt = now();
      const late = Boolean(round.deadline && new Date(submittedAt) > new Date(round.deadline));
      workspace.submissions.push({ id: id(), userId: user._id.toString(), students, groupId, ccaId: String(cca._id), roundId: String(round._id), name: payload.name || payload.filename || 'Task submission', url: payload.url || '', filename: payload.filename || '', fileKey: payload.fileKey || '', submittedAt, late, status: late ? 'Late Submitted' : 'Submitted' });
      addNotification(workspace, 'Task submission recorded', user._id.toString(), payload.ccaId);
      addAudit(workspace, actor, role, 'Task submitted', payload.roundId);
    } else if (action === 'createGroup') {
      requireRole('cca');
      requireStage('configuration', 'selection');
      const round = requireRound();
      if (!String(round.type).startsWith('Group') || round.status === 'Completed') fail('Choose an available group round.');
      const students = [...new Set((payload.students || []).map(String))];
      if (students.length < 2) fail('A group needs at least two students.');
      if (workspace.groups.some((group) => group.roundId === String(round._id) && group.students.some((student) => students.includes(student)))) fail('One of these students is already in a group for this round.', 409);
      const members = await User.find({ _id: { $in: students } });
      if (members.length !== students.length || members.some((entry) => !isActiveApplication(entry, cca._id))) fail('Groups can contain only active applicants.');
      const panel = workspace.panels.find((item) => item.id === payload.panelId && item.roundId === String(round._id) && item.ccaId === String(cca._id));
      if (!panel || students.some((student) => !panel.students?.includes(student))) fail('Assign the whole group to one panel first.');
      workspace.groups.push({ id: id(), ccaId: String(cca._id), roundId: String(round._id), panelId: panel.id, name: String(payload.name || '').trim() || `Group ${workspace.groups.length + 1}`, students, createdAt: now() });
      addAudit(workspace, actor, role, 'Group assigned', cca.name, { roundId: String(round._id), students });
    } else if (action === 'lockEvaluation') {
      requireRole('cca');
      requireStage('selection');
      const round = requireRound();
      requireCCAControl('evaluations');
      if (isCVReview(round)) fail('Round 0 is CV review only; marks begin in Round 1.');
      if (round.status !== 'Active' || isScreening(round)) fail('Marks can be entered only for an active scored round.');
      const panel = payload.panelId && workspace.panels.find((item) => item.id === payload.panelId && item.ccaId === String(cca._id) && item.roundId === String(round._id));
      if (isInterview(round) && !panel) fail('Choose a panel assigned to this interview round.');
      if (role === 'cca' && panel && !panel.members.includes(user.email)) fail('Only assigned panel members can evaluate.', 403);
      const entries = payload.entries || [];
      if (!entries.length) return res.status(400).json({ msg: 'Add at least one evaluation.' });
      if (new Set(entries.map((entry) => entry.userId)).size !== entries.length) fail('Each student can be evaluated only once.');
      const students = await User.find({ _id: { $in: entries.map((entry) => entry.userId) } });
      if (students.length !== entries.length || students.some((entry) => !isActiveApplication(entry, cca._id))) fail('Only active applicants can be evaluated.');
      if (panel && entries.some((entry) => !panel.students?.includes(entry.userId))) fail('Evaluators may score only students assigned to their panel.', 403);
      const session = payload.sessionId && panel ? workspace.sessions.find((item) => item.id === payload.sessionId && item.panelId === panel.id && item.roundId === String(round._id)) : null;
      if (isInterview(round) && (!session || session.status !== 'Evaluation pending' || entries.length !== session.students.length || entries.some((entry) => !session.students.includes(entry.userId) || !session.exited.includes(entry.userId)))) fail('Complete the assigned interview and evaluate every participant before locking marks.');
      for (const entry of entries) {
        if (workspace.evaluations.some((evaluation) => evaluation.roundId === payload.roundId && evaluation.userId === entry.userId)) fail('Marks are already locked for one of these students.', 409);
        if (entry.total === '' || entry.total === null || entry.total === undefined) fail('Enter a mark for every student.');
        const total = Number(entry.total);
        if (!Number.isFinite(total) || total < 0 || total > round.maxMarks || (!workspace.policy.decimals && !Number.isInteger(total))) return res.status(400).json({ msg: `Scores must be between 0 and ${round.maxMarks}.` });
        let taskScore = null;
        let interviewScore = null;
        if (isTask(round) && isInterview(round) && round.taskMaxMarks > 0 && round.interviewMaxMarks > 0) {
          if (entry.taskScore === '' || entry.interviewScore === '' || entry.taskScore == null || entry.interviewScore == null) fail('Enter both task and interview marks.');
          taskScore = Number(entry.taskScore);
          interviewScore = Number(entry.interviewScore);
          if (!Number.isFinite(taskScore) || !Number.isFinite(interviewScore) || taskScore < 0 || interviewScore < 0 || taskScore > round.taskMaxMarks || interviewScore > round.interviewMaxMarks || taskScore + interviewScore !== total) fail('Task and interview marks must be within their maximums and add up to the total.');
        } else if (isTask(round) && !isInterview(round)) taskScore = total;
        else if (isInterview(round) && !isTask(round)) interviewScore = total;
        workspace.evaluations.push({ id: id(), ccaId: cca._id.toString(), roundId: String(round._id), userId: entry.userId, panelId: panel?.id || null, total, taskScore, interviewScore, maxMarks: round.maxMarks, locked: true, actor, createdAt: now() });
      }
      if (session) session.status = 'Marks locked';
      if (panel) panel.locked = true;
      addAudit(workspace, actor, role, 'Evaluations locked', cca.name, { count: entries.length, round: round.name });
    } else if (action === 'screenApplicants') {
      requireRole('cca');
      requireStage('selection');
      const round = requireRound();
      if (!isScreening(round) || round.status !== 'Active') fail('Round 0 is not active.');
      const decisions = payload.decisions || [];
      if (!decisions.length || new Set(decisions.map((entry) => entry.userId)).size !== decisions.length || decisions.some((entry) => !['Promoted', 'Eliminated'].includes(entry.decision))) fail('Record one promoted or eliminated decision per student.');
      const panel = workspace.panels.find((item) => item.id === payload.panelId && item.ccaId === String(cca._id) && item.roundId === String(round._id));
      if (!panel || decisions.some((entry) => !panel.students?.includes(entry.userId))) fail('Choose the assigned panel and its students.');
      if (!panel.members.includes(user.email)) fail('Only assigned panel members can screen these applicants.', 403);
      const students = await User.find({ _id: { $in: decisions.map((entry) => entry.userId) } });
      if (students.length !== decisions.length || students.some((entry) => !isActiveApplication(entry, cca._id))) fail('Screening decisions must belong to active applicants.');
      if (decisions.some((entry) => workspace.screeningDecisions.some((decision) => decision.roundId === String(round._id) && decision.userId === entry.userId))) fail('A screening decision is already locked.', 409);
      if (isInterview(round)) {
        for (const entry of decisions) {
          const session = workspace.sessions.find((item) => item.id === entry.sessionId && item.roundId === String(round._id) && item.students.includes(entry.userId) && item.exited.includes(entry.userId));
          if (!session || session.status !== 'Evaluation pending') fail('Complete the interview before recording its screening decision.');
        }
        for (const entry of decisions) workspace.sessions.find((item) => item.id === entry.sessionId).status = 'Marks locked';
      }
      for (const entry of decisions) workspace.screeningDecisions.push({ id: id(), ccaId: String(cca._id), roundId: String(round._id), userId: entry.userId, decision: entry.decision, actor, lockedAt: now() });
      addAudit(workspace, actor, role, 'Screening decisions locked', cca.name, { count: decisions.length });
    } else if (action === 'completeRound') {
      requireRole('cca');
      requireStage('selection');
      const round = requireRound();
      requireCCAControl('evaluations');
      if (isCVReview(round)) fail('Round 0 cannot be scored or completed. Complete the CV review to open Round 1.');
      if (round.status !== 'Active' || String(cca.rounds[cca.currentRound]?._id) !== String(round._id)) fail('Only the current active round can be completed.');
      const users = await User.find({ appliedCCAs: cca._id });
      const active = users.filter((entry) => {
        const app = entry.selectionApplications.find((item) => item.cca.toString() === cca._id.toString());
        return !app || ['Applied', 'Participating'].includes(app.status);
      });
      if (!active.length) fail('There are no active applicants.');
      const roundId = String(round._id);
      const missing = active.filter((entry) => !(isScreening(round) ? workspace.screeningDecisions : workspace.evaluations).some((item) => item.roundId === roundId && item.userId === String(entry._id)));
      if (missing.length) fail(`Record and lock all ${missing.length} remaining decisions before completing this round.`);
      const eliminatedIds = new Set(isScreening(round)
        ? active.filter((entry) => workspace.screeningDecisions.find((item) => item.roundId === roundId && item.userId === String(entry._id))?.decision === 'Eliminated').map((entry) => String(entry._id))
        : []);
      for (const entry of active) {
        const app = entry.selectionApplications.find((item) => item.cca.toString() === cca._id.toString());
        if (app) app.status = eliminatedIds.has(String(entry._id)) ? 'Eliminated' : 'Participating';
        await entry.save();
        addNotification(workspace, eliminatedIds.has(String(entry._id)) ? `Your participation in ${cca.name} has ended after ${round.name}.` : `${round.name} completed · ${cca.name}`, String(entry._id), String(cca._id));
      }
      round.status = 'Completed';
      round.completedAt = new Date();
      const roundIndex = cca.rounds.findIndex((item) => item._id.equals(round._id));
      if (roundIndex >= cca.rounds.length - 1) cca.selectionStatus = 'Awaiting ratification'; else { cca.currentRound = roundIndex + 1; cca.rounds[roundIndex + 1].status = 'Active'; cca.rounds[roundIndex + 1].startedAt = new Date(); cca.rounds[roundIndex + 1].policyVersion = workspace.policy.version; cca.rounds[roundIndex + 1].poolMultiplier = workspace.policy.multiplier; cca.selectionStatus = 'Locked'; for (const entry of active) if (!eliminatedIds.has(String(entry._id))) addNotification(workspace, `${cca.rounds[roundIndex + 1].name} is open · ${cca.name}${isTask(cca.rounds[roundIndex + 1]) ? ' · Task assigned' : ''}`, String(entry._id), String(cca._id)); }
      await cca.save();
      addAudit(workspace, actor, role, 'Round completed', cca.name, { round: round.name, eliminated: eliminatedIds.size, policyVersion: round.policyVersion });
    } else if (action === 'ratifyResults') {
      requireRole('senate');
      requireStage('selection');
      if (!cca) return res.status(404).json({ msg: 'CCA not found' });
      requireCCAControl('results');
      if (cca.selectionStatus !== 'Awaiting ratification' || cca.rounds.some((round) => round.status !== 'Completed')) fail('Complete and lock every round before ratification.');
      if (cca.resultsPublished) fail('Results are already published.', 409);
      const users = await User.find({ appliedCCAs: cca._id });
      const active = users.map((entry) => ({ user: entry, application: entry.selectionApplications.find((item) => item.cca.toString() === cca._id.toString()) })).filter((entry) => entry.application && entry.application.status === 'Participating');
      for (const vertical of cca.verticals.length ? cca.verticals : [{ name: 'General', seats: cca.seats }]) {
        const ranked = active.filter((entry) => entry.application.vertical === vertical.name || cca.verticals.length === 0).map((entry) => ({ ...entry, score: scoreFor(workspace, cca, entry.user._id.toString()), finalRoundScore: rawRoundScore(workspace, cca.rounds.at(-1), String(entry.user._id)) })).sort((a, b) => b.score - a.score || (workspace.policy.tieBreaker === 'earliestApplication' ? new Date(a.application.createdAt) - new Date(b.application.createdAt) : b.finalRoundScore - a.finalRoundScore) || String(a.user._id).localeCompare(String(b.user._id)));
        for (let index = 0; index < ranked.length; index += 1) { ranked[index].application.status = index < vertical.seats ? 'Selected' : 'Waitlisted'; await ranked[index].user.save(); addNotification(workspace, `Final result published · ${cca.name}`, ranked[index].user._id.toString(), cca._id.toString()); }
      }
      cca.selectionStatus = 'Completed';
      cca.resultsPublished = true;
      await cca.save();
      addAudit(workspace, actor, role, 'Results ratified', cca.name);
    } else if (action === 'correctMark') {
      requireRole('senate');
      requireStage('selection');
      const evaluation = workspace.evaluations.find((item) => item.id === payload.evaluationId);
      if (!evaluation) fail('Locked evaluation not found.', 404);
      const targetCCA = await CCA.findById(evaluation.ccaId);
      const round = targetCCA?.rounds.id(evaluation.roundId);
      if (!round || round.status !== 'Active' || targetCCA.resultsPublished) fail('Corrections must be resolved before the round is completed.');
      const total = Number(payload.total);
      if (!Number.isFinite(total) || total < 0 || total > round.maxMarks || (!workspace.policy.decimals && !Number.isInteger(total))) fail(`The corrected mark must be between 0 and ${round.maxMarks}.`);
      if (!String(payload.reason || '').trim() || !String(payload.evidence || '').trim()) fail('Record the reason and supporting evidence.');
      workspace.markCorrections.push({ id: id(), evaluationId: evaluation.id, ccaId: evaluation.ccaId, roundId: evaluation.roundId, userId: evaluation.userId, previousTotal: workspace.markCorrections.filter((item) => item.evaluationId === evaluation.id).at(-1)?.total ?? evaluation.total, total, reason: String(payload.reason).trim(), evidence: String(payload.evidence).trim(), authorizedBy: actor, createdAt: now() });
      addAudit(workspace, actor, role, 'Locked mark corrected', targetCCA.name, { evaluationId: evaluation.id, reason: payload.reason, total });
    } else if (action === 'raiseException') {
      requireRole('cca', 'senate');
      requireStage('selection');
      if (!payload.reason?.trim()) return res.status(400).json({ msg: 'Describe the exception.' });
      if (role === 'cca') requireCCAAccess();
      if (payload.sessionId && !workspace.sessions.some((item) => item.id === payload.sessionId && item.ccaId === String(cca._id))) fail('Choose an interview from this CCA.');
      workspace.exceptions.push({ id: id(), ccaId: payload.ccaId, sessionId: payload.sessionId || null, reason: payload.reason.trim(), status: 'Open', resolution: '', createdAt: now() });
      addAudit(workspace, actor, role, 'Exception raised', payload.ccaId, { reason: payload.reason });
    } else if (action === 'overrideInterview') {
      requireRole('senate');
      requireStage('selection');
      const exception = workspace.exceptions.find((item) => item.id === payload.exceptionId && item.status === 'Open' && item.sessionId);
      const session = exception && workspace.sessions.find((item) => item.id === exception.sessionId);
      if (!session) fail('An open interview exception is required.', 404);
      if (!String(payload.reason || '').trim() || !String(payload.evidence || '').trim()) fail('Record a reason and supporting evidence.');
      if (payload.operation === 'markStudentComplete') {
        if (!session.panelEntered || !session.entered?.includes(payload.userId) || session.exited?.includes(payload.userId)) fail('Only a student who entered this interview can be marked complete.');
        session.exited = [...(session.exited || []), payload.userId];
        if (session.exited.length >= session.students.length) session.status = 'Evaluation pending';
      } else if (payload.operation === 'terminate') {
        if (['Completed', 'Terminated', 'Marks locked'].includes(session.status)) fail('This interview can no longer be terminated.');
        session.status = 'Terminated';
      } else if (payload.operation === 'releasePanel') {
        if (!['Marks locked', 'Terminated'].includes(session.status)) fail('Lock the evaluation or terminate the interview before releasing its panel.');
        session.status = 'Completed';
      } else fail('Choose an allowed interview override.');
      session.events = [...(session.events || []), { action: `senate:${payload.operation}`, at: now(), actor, reason: payload.reason }];
      exception.status = 'Resolved';
      exception.resolution = String(payload.reason).trim();
      exception.resolvedAt = now();
      addAudit(workspace, actor, role, 'Interview override authorized', session.id, { operation: payload.operation, reason: payload.reason, evidence: payload.evidence, userId: payload.userId });
      for (const student of session.students) addNotification(workspace, `Interview updated by Senate · ${session.status}`, student, session.ccaId);
    } else if (action === 'resolveException') {
      requireRole('senate');
      const exception = workspace.exceptions.find((item) => item.id === payload.exceptionId);
      if (!exception || exception.status !== 'Open' || !payload.resolution?.trim()) return res.status(400).json({ msg: 'Provide a resolution for an open exception.' });
      exception.status = 'Resolved'; exception.resolution = payload.resolution.trim(); exception.resolvedAt = now();
      addAudit(workspace, actor, role, 'Exception resolved', exception.id, { resolution: exception.resolution });
    } else if (action === 'addMember') {
      requireRole('senate');
      const member = await User.findOne({ email: String(payload.email || '').toLowerCase().trim() });
      if (!member) return res.status(404).json({ msg: 'That person must register in Calvin before access can be assigned.' });
      if (!['student', 'cca', 'senate'].includes(payload.role)) return res.status(400).json({ msg: 'Choose student, CCA, or Senate access.' });
      if (payload.role === 'cca' && !await CCA.exists({ _id: payload.ccaId })) return res.status(400).json({ msg: 'Assign a valid CCA.' });
      member.role = payload.role;
      member.ccaAssignment = payload.role === 'cca' ? payload.ccaId || null : null;
      member.fullName = payload.fullName || member.fullName;
      member.rollNumber = payload.rollNumber || member.rollNumber;
      await member.save();
      addAudit(workspace, actor, role, 'Member access updated', member.email, { role: member.role, ccaId: member.ccaAssignment });
    } else if (action === 'readNotifications') {
      for (const notification of workspace.notifications) {
        const addressed = notification.userId === String(user._id) || (!notification.userId && !notification.ccaId) || (role === 'cca' && notification.ccaId === String(user.ccaAssignment)) || role === 'senate';
        if (addressed && !notification.readBy.includes(String(user._id))) notification.readBy.push(String(user._id));
      }
      addAudit(workspace, actor, role, 'Notifications read', user._id.toString());
    } else {
      return res.status(400).json({ msg: 'Unknown selection action.' });
    }

    ['panels', 'panelRuns', 'sessions', 'submissions', 'groups', 'evaluations', 'screeningDecisions', 'markCorrections', 'exceptions', 'notifications', 'audit', 'archives'].forEach((field) => workspace.markModified(field));
    await workspace.save();
    if (roundEmailNotice && process.env.RESEND_API_KEY && process.env.ROUND_EMAIL_FROM) {
      const recipients = roundEmailNotice.students.filter((entry) => isActiveApplication(entry, roundEmailNotice.cca._id) && entry.email);
      for (const student of recipients) {
        try {
          const emailResponse = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.ROUND_EMAIL_FROM, to: [student.email], subject: roundEmailNotice.subject, text: `${roundEmailNotice.round.name} for ${roundEmailNotice.cca.name} ${roundEmailNotice.subject.includes('updated') ? 'has been updated' : 'has been published'}.\n\nScheduled start: ${new Date(roundEmailNotice.round.startAt).toLocaleString('en-IN')}.\nDeadline: ${roundEmailNotice.round.deadline ? new Date(roundEmailNotice.round.deadline).toLocaleString('en-IN') : 'Not set'}.\n\n${roundEmailNotice.round.instructions || ''}` }) });
          if (!emailResponse.ok) console.error('Round announcement email was rejected by Resend:', emailResponse.status);
        } catch (emailError) { console.error('Round publication email failed:', emailError.message); }
      }
    }
    res.json({ msg: 'Saved successfully', revision: workspace.revision, ...actionResult });
  } catch (error) {
    if ([403, 409].includes(error.status) && req.userId && req.body?.action) {
      try {
        const [workspace, actorUser] = await Promise.all([workspaceFor(), User.findById(req.userId).select('email role')]);
        const entity = String(req.body.payload?.ccaId || req.body.payload?.sessionId || req.body.action);
        addAudit(workspace, actorUser?.email || String(req.userId), actorUser?.role || 'unknown', `Rejected ${req.body.action}`, entity, { reason: error.message });
        workspace.exceptions.push({ id: id(), kind: 'rejectedAction', ccaId: req.body.payload?.ccaId || null, reason: `${req.body.action} rejected: ${error.message}`, status: 'Open', createdAt: now() });
        workspace.markModified('exceptions');
        workspace.markModified('audit');
        await workspace.save();
      } catch { /* Keep the original API error if audit storage is unavailable. */ }
    }
    res.status(error.status || 500).json({ msg: error.message || 'Server Error' });
  }
});

module.exports = router;
