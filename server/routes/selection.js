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
fs.mkdirSync(taskTempRoot, { recursive: true });
const taskUpload = multer({
  dest: taskTempRoot,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'application/x-zip-compressed'].includes(file.mimetype))
});
const allowedRoles = new Set(['student', 'cca', 'senate', 'admin']);
const roundTypes = new Set(['Individual · Task', 'Individual · Task + Interview', 'Individual · Interview', 'Group · Task', 'Group · Task + Interview', 'Group · Interview']);
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
  weight: 0, eliminate: 0, deadline: null,
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
    review.eliminate = 0;
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
const isInterview = (round) => String(round?.type || '').includes('Interview');
const isTask = (round) => String(round?.type || '').includes('Task');
const belongsToCCA = (user, role, ccaId) => role === 'senate' || (role === 'cca' && String(user.ccaAssignment || '') === String(ccaId));
const isActiveApplication = (user, ccaId) => (user.selectionApplications || []).some((item) => String(item.cca) === String(ccaId) && ['Applied', 'Participating'].includes(item.status));
const roundFor = (cca, roundId) => cca?.rounds?.id(roundId);
const minimumPool = (workspace, cca, round) => {
  const multiplier = round?.poolMultiplier ?? workspace.policy?.multiplier;
  return multiplier === null ? 0 : Math.ceil(Number(cca.constitutionalStrength || cca.seats || 0) * Number(multiplier || 0));
};

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
    const visibleCCAs = role === 'cca' ? ccas.filter((cca) => cca._id.toString() === ccaId) : ccas;
    const visibleUserIds = new Set(applications.map((application) => application.userId));
    const students = users.filter((entry) => role === 'senate' || visibleUserIds.has(entry._id.toString())).map((entry) => ({
      id: entry._id,
      name: entry.fullName || entry.email.split('@')[0],
      email: entry.email,
      rollNumber: entry.rollNumber,
      role: entry.role,
      ccaAssignment: entry.ccaAssignment
    }));
    const visible = (items) => role === 'senate'
      ? items
      : role === 'cca'
        ? items.filter((item) => item.ccaId === ccaId)
        : items.filter((item) => item.userId === user._id.toString() || item.students?.includes(user._id.toString()));

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
      applications,
      panels: visible(workspace.panels),
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
      const allowedTransitions = {
        applications: ['configuration'],
        configuration: ['applications', 'selection'],
        selection: ['configuration', 'completed'],
        completed: ['selection']
      };
      if (payload.stage !== previousStage && !allowedTransitions[previousStage]?.includes(payload.stage)) {
        return res.status(400).json({ msg: `Move from ${previousStage} to an adjacent portal stage first.` });
      }
      if (payload.stage === 'completed' && await CCA.exists({ selectionStatus: { $in: ['Locked', 'Awaiting ratification'] } })) fail('Finish and ratify active CCA selections before completing the cycle.');
      if (payload.stage === 'selection' && previousStage === 'configuration') {
        const configuredCCAs = await CCA.find({ selectionStatus: { $in: ['Draft', 'Finalized'] } });
        for (const configuredCCA of configuredCCAs) {
          const reviewRound = ensureCVReviewRound(configuredCCA);
          const firstScoredRound = configuredCCA.rounds.find((round) => !isCVReview(round));
          if (configuredCCA.selectionStatus === 'Finalized' && firstScoredRound && firstScoredRound.eliminate < 1) {
            firstScoredRound.eliminate = 1;
            addAudit(workspace, actor, role, 'Round 1 elimination defaulted', configuredCCA.name, { eliminate: 1 });
          }
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
        if ((startDate && Number.isNaN(startDate.getTime())) || (endDate && Number.isNaN(endDate.getTime())) || (startDate && endDate && startDate >= endDate)) {
          return res.status(400).json({ msg: `The ${stage} window needs a valid start before its end.` });
        }
        const start = startDate ? startDate.toISOString() : null;
        const end = endDate ? endDate.toISOString() : null;
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
    } else if (action === 'configureCCA') {
      requireRole('cca');
      requireStage('configuration');
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
      const scoredRounds = (payload.rounds || []).map((round) => ({
        name: String(round.name || '').trim(), type: round.type || 'Individual · Task', maxMarks: Number(round.maxMarks), taskMaxMarks: Number(round.taskMaxMarks ?? (isTask(round) && !isInterview(round) ? round.maxMarks : 0)), interviewMaxMarks: Number(round.interviewMaxMarks ?? (isInterview(round) && !isTask(round) ? round.maxMarks : 0)), weight: Number(round.weight), eliminate: Number(round.eliminate || 0), deadline: round.deadline || null, instructions: round.instructions || '', criteria: round.criteria || '', status: 'Draft', policyVersion: workspace.policy.version, poolMultiplier: workspace.policy.multiplier
      }));
      if (!scoredRounds.length || scoredRounds.some((round) => !round.name || !Number.isFinite(round.maxMarks) || round.maxMarks <= 0 || !Number.isFinite(round.weight) || round.weight <= 0 || !Number.isInteger(round.eliminate) || round.eliminate < 0 || (round.deadline && Number.isNaN(Date.parse(round.deadline))))) return res.status(400).json({ msg: 'Add at least one scored round with valid marks, weight, elimination count, and deadline.' });
      if (scoredRounds.some((round) => isTask(round) && isInterview(round) && (round.taskMaxMarks <= 0 || round.interviewMaxMarks <= 0 || round.taskMaxMarks + round.interviewMaxMarks !== round.maxMarks))) fail('Task + Interview marks must each be positive and add up to the round maximum.');
      if (scoredRounds.some((round) => !roundTypes.has(round.type))) fail('Choose a supported Round 1 or later type. Round 0 is reserved for CV review.');
      if (scoredRounds[0].eliminate < 1) fail('Round 1 must eliminate at least one applicant. Set its elimination count before finalizing.');
      const oldScoredRounds = cca.rounds.filter((round) => !isCVReview(round));
      const retainedIds = new Set();
      const rounds = [makeCVReviewRound(), ...scoredRounds.map((round, index) => {
        const previous = oldScoredRounds.find((item) => item.name === round.name && !retainedIds.has(String(item._id)))
          || oldScoredRounds[index] && !retainedIds.has(String(oldScoredRounds[index]._id)) && oldScoredRounds[index];
        if (previous) { round._id = previous._id; retainedIds.add(String(previous._id)); }
        return round;
      })];
      const retainedRoundIds = new Set(rounds.map((round) => String(round._id)));
      const removedRoundIds = new Set(oldScoredRounds.filter((round) => !retainedIds.has(String(round._id))).map((round) => String(round._id)));
      if (removedRoundIds.size) {
        const removedPanelIds = new Set(workspace.panels.filter((panel) => panel.ccaId === String(cca._id) && removedRoundIds.has(panel.roundId)).map((panel) => panel.id));
        workspace.panels = workspace.panels.filter((panel) => !removedPanelIds.has(panel.id));
        workspace.sessions = workspace.sessions.filter((session) => !removedPanelIds.has(session.panelId));
        workspace.groups = workspace.groups.filter((group) => group.ccaId !== String(cca._id) || !removedRoundIds.has(group.roundId));
      }
      workspace.panels = workspace.panels.filter((panel) => panel.ccaId !== String(cca._id) || retainedRoundIds.has(panel.roundId));
      cca.seats = cca.selectionStatus === 'Draft' ? seats : cca.seats;
      cca.constitutionalStrength = cca.selectionStatus === 'Draft' ? constitutionalStrength : cca.constitutionalStrength;
      cca.contactPerson = String(payload.contactPerson || '').trim();
      cca.selectionCoordinators = String(payload.selectionCoordinators || '').split('\n').map((entry) => entry.trim()).filter(Boolean);
      if (String(payload.description || '').trim()) cca.description = String(payload.description).trim();
      if (cca.selectionStatus === 'Draft') cca.verticals = verticals;
      cca.rounds = rounds;
      cca.applicationDeadline = payload.applicationDeadline || null;
      if (cca.selectionStatus === 'Draft') cca.selectionStatus = 'Draft';
      cca.currentRound = 0;
      cca.resultsPublished = false;
      await cca.save();
      addAudit(workspace, actor, role, 'CCA configured', cca.name, { seats, verticals, rounds: rounds.length });
    } else if (action === 'setCCAStatus') {
      requireRole('cca');
      requireStage('configuration', 'selection');
      requireCCAAccess();
      const transitions = { Draft: ['Finalized'], Finalized: ['Locked'] };
      if (!transitions[cca.selectionStatus]?.includes(payload.status)) fail('This selection status cannot be changed manually.');
      if (payload.status === 'Finalized' && (!cca.seats || !cca.verticals.length || !cca.rounds.length)) fail('Set seats, verticals, and rounds before finalizing.');
      if (payload.status === 'Finalized') {
        const reviewRound = ensureCVReviewRound(cca);
        const firstScoredRound = cca.rounds.find((round) => !isCVReview(round));
        if (firstScoredRound && firstScoredRound.eliminate < 1) firstScoredRound.eliminate = 1;
        if (workspace.stage === 'selection' && reviewRound.status === 'Draft') { reviewRound.status = 'Active'; reviewRound.startedAt = new Date(); }
      }
      if (payload.status === 'Locked') {
        requireStage('selection');
        const reviewRound = cca.rounds.find(isCVReview);
        const firstScoredRound = cca.rounds.find((round) => !isCVReview(round));
        if (!reviewRound || reviewRound.status !== 'Active') fail('Round 0 CV review must be open before starting Round 1.');
        if (!firstScoredRound) fail('Configure at least one scored round after CV review.');
        if (cca.rounds.filter((round) => !isCVReview(round)).some((round) => !workspace.panels.some((panel) => panel.ccaId === String(cca._id) && panel.roundId === String(round._id)))) fail('Configure at least one panel for every scored round before starting Round 1.');
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
      requireStage('configuration');
      const round = requireRound();
      if (isCVReview(round)) fail('Round 0 is CV review only; create panels for Round 1 or later.');
      if (!['Draft', 'Finalized'].includes(cca.selectionStatus) || round.status !== 'Draft') fail('Panel membership is locked once selection starts.', 409);
      const members = (payload.members || []).map(String).map((entry) => entry.trim()).filter(Boolean);
      if (!members.length) return res.status(400).json({ msg: 'Add at least one panel member.' });
      if (process.env.NODE_ENV === 'production') {
        const registered = await User.countDocuments({ email: { $in: members }, role: 'cca', ccaAssignment: cca._id });
        if (registered !== new Set(members).size) fail('Every panel member needs registered CCA access for this team.');
      }
      workspace.panels.push({ id: id(), ccaId: cca._id.toString(), roundId: String(round._id), name: payload.name || `Panel ${workspace.panels.length + 1}`, members, students: [], locked: false, createdAt: now() });
      addAudit(workspace, actor, role, 'Panel created', cca.name, { members: members.length });
    } else if (action === 'assignPanelStudents') {
      requireRole('cca');
      requireStage('configuration', 'selection');
      requireCCAAccess();
      const panel = workspace.panels.find((item) => item.id === payload.panelId && item.ccaId === String(cca._id));
      const round = panel && roundFor(cca, panel.roundId);
      if (round && isCVReview(round)) fail('Round 0 has no panels or assignments.');
      if (!panel || !round || panel.locked || round.status === 'Completed') fail('Panel assignments are locked.', 409);
      const studentIds = [...new Set((payload.students || []).map(String))];
      if (!studentIds.length) fail('Assign at least one student.');
      if (workspace.panels.some((item) => item.id !== panel.id && item.roundId === panel.roundId && item.students?.some((student) => studentIds.includes(student)))) fail('A student is already assigned to another panel for this round.', 409);
      const applicants = await User.find({ _id: { $in: studentIds } });
      if (applicants.length !== studentIds.length || applicants.some((entry) => !isActiveApplication(entry, cca._id))) fail('Only active applicants can be assigned to panels.');
      panel.students = studentIds;
      addAudit(workspace, actor, role, 'Panel students assigned', cca.name, { panelId: panel.id, count: studentIds.length });
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
      if (!(process.env.NODE_ENV !== 'production') && role === 'cca' && !panel.members.includes(user.email)) fail('Only a member of this panel may schedule its interviews.', 403);
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
        if (!(process.env.NODE_ENV !== 'production') && role === 'cca' && !panel?.members.includes(user.email)) fail('You are not a member of this interview panel.', 403);
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
      const panel = workspace.panels.find((item) => item.id === payload.panelId && item.ccaId === String(cca._id) && item.roundId === String(round._id));
      if (!panel) fail('Choose a panel assigned to this round.');
      if (!(process.env.NODE_ENV !== 'production') && role === 'cca' && !panel.members.includes(user.email)) fail('Only assigned panel members can evaluate.', 403);
      const entries = payload.entries || [];
      if (!entries.length) return res.status(400).json({ msg: 'Add at least one evaluation.' });
      if (new Set(entries.map((entry) => entry.userId)).size !== entries.length) fail('Each student can be evaluated only once.');
      const students = await User.find({ _id: { $in: entries.map((entry) => entry.userId) } });
      if (students.length !== entries.length || students.some((entry) => !isActiveApplication(entry, cca._id))) fail('Only active applicants can be evaluated.');
      if (entries.some((entry) => !panel.students?.includes(entry.userId))) fail('Evaluators may score only students assigned to their panel.', 403);
      const session = payload.sessionId ? workspace.sessions.find((item) => item.id === payload.sessionId && item.panelId === panel.id && item.roundId === String(round._id)) : null;
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
        workspace.evaluations.push({ id: id(), ccaId: cca._id.toString(), roundId: String(round._id), userId: entry.userId, panelId: panel.id, total, taskScore, interviewScore, maxMarks: round.maxMarks, locked: true, actor, createdAt: now() });
      }
      if (session) session.status = 'Marks locked';
      panel.locked = true;
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
      if (process.env.NODE_ENV === 'production' && !panel.members.includes(user.email)) fail('Only assigned panel members can screen these applicants.', 403);
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
      const eliminationCount = isScreening(round)
        ? active.filter((entry) => workspace.screeningDecisions.find((item) => item.roundId === roundId && item.userId === String(entry._id))?.decision === 'Eliminated').length
        : Number(payload.eliminate ?? round.eliminate ?? 0);
      if (!Number.isInteger(eliminationCount) || eliminationCount < 0 || eliminationCount > active.length) fail('Choose a valid number to eliminate.');
      const poolFloor = minimumPool(workspace, cca, round);
      if (eliminationCount > 0 && active.length - eliminationCount < poolFloor) fail(`At least ${poolFloor} candidates must remain under policy v${round.policyVersion || workspace.policy.version}.`);
      const ranked = active.map((entry) => {
        const evaluation = workspace.evaluations.find((item) => item.roundId === roundId && item.userId === String(entry._id));
        const correction = workspace.markCorrections.filter((item) => item.evaluationId === evaluation?.id).at(-1);
        return { user: entry, score: Number(correction?.total ?? evaluation?.total ?? 0), cumulative: scoreFor(workspace, cca, String(entry._id)) };
      }).sort((a, b) => b.score - a.score || b.cumulative - a.cumulative || String(a.user._id).localeCompare(String(b.user._id)));
      const eliminatedIds = new Set(isScreening(round)
        ? active.filter((entry) => workspace.screeningDecisions.find((item) => item.roundId === roundId && item.userId === String(entry._id))?.decision === 'Eliminated').map((entry) => String(entry._id))
        : ranked.slice(Math.max(0, ranked.length - eliminationCount)).map((entry) => String(entry.user._id)));
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
      addAudit(workspace, actor, role, 'Round completed', cca.name, { round: round.name, eliminated: eliminatedIds.size, policyVersion: round.policyVersion, minimumPool: poolFloor });
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

    ['panels', 'sessions', 'submissions', 'groups', 'evaluations', 'screeningDecisions', 'markCorrections', 'exceptions', 'notifications', 'audit', 'archives'].forEach((field) => workspace.markModified(field));
    await workspace.save();
    res.json({ msg: 'Saved successfully', revision: workspace.revision });
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
