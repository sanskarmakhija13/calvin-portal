const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const mongoose = require('mongoose');
const router = express.Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const CCA = require('../models/CCA');
const SelectionWorkspace = require('../models/SelectionWorkspace');

const uploadRoot = path.join(__dirname, '..', 'uploads');
const tempRoot = path.join(uploadRoot, 'tmp');
fs.mkdirSync(tempRoot, { recursive: true });
const upload = multer({
  dest: tempRoot,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.mimetype))
});
const removeFile = (filePath) => { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); };
const workspaceFor = () => SelectionWorkspace.findOneAndUpdate({ key: 'default' }, { $setOnInsert: { key: 'default' } }, { new: true, upsert: true, setDefaultsOnInsert: true });
const isCVReview = (round) => round?.type === 'CV Review · No elimination';
const recordActivity = async (workspace, user, action, entity, notice = null) => {
  workspace.audit.unshift({ id: new mongoose.Types.ObjectId().toString(), actor: user.email, role: 'student', action, entity, createdAt: new Date().toISOString() });
  if (notice) workspace.notifications.push({ id: new mongoose.Types.ObjectId().toString(), text: notice, userId: String(user._id), readBy: [], createdAt: new Date().toISOString() });
  workspace.markModified('audit');
  workspace.markModified('notifications');
  workspace.revision += 1;
  await workspace.save();
};

router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('email fullName rollNumber role ccaAssignment');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    res.json({ email: user.email, fullName: user.fullName, rollNumber: user.rollNumber, role: user.role, ccaAssignment: user.ccaAssignment });
  } catch (err) { res.status(500).send('Server Error'); }
});

router.get('/cvs', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('cvs');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    res.json((user.cvs || []).map((cv) => ({ id: cv._id, filename: cv.filename, mimeType: cv.mimeType, size: cv.size, uploadedAt: cv.uploadedAt })));
  } catch (err) { res.status(500).send('Server Error'); }
});

router.post('/cvs', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ msg: 'Upload a PDF, DOC, or DOCX CV.' });
  try {
    const user = await User.findById(req.userId);
    if (!user) { removeFile(req.file.path); return res.status(404).json({ msg: 'User not found' }); }
    if ((user.cvs || []).length >= 3) { removeFile(req.file.path); return res.status(400).json({ msg: 'You can store a maximum of 3 CVs.' }); }
    const hash = crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex');
    if ((user.cvs || []).some((cv) => cv.hash === hash)) { removeFile(req.file.path); return res.status(409).json({ msg: 'That CV is already uploaded.' }); }
    const cvId = new mongoose.Types.ObjectId();
    const extension = path.extname(req.file.originalname).toLowerCase() || '.file';
    const userFolder = path.join(uploadRoot, 'cvs', req.userId.toString());
    fs.mkdirSync(userFolder, { recursive: true });
    const storedFilename = `${cvId}${extension}`;
    fs.renameSync(req.file.path, path.join(userFolder, storedFilename));
    const cv = { _id: cvId, filename: req.file.originalname, storedFilename: path.join(req.userId.toString(), storedFilename), mimeType: req.file.mimetype, size: req.file.size, hash };
    user.cvs.push(cv);
    await user.save();
    res.status(201).json({ id: cv._id, filename: cv.filename, mimeType: cv.mimeType, size: cv.size, uploadedAt: cv.uploadedAt });
  } catch (err) { removeFile(req.file.path); res.status(500).send('Server Error'); }
});

router.delete('/cvs/:cvId', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ msg: 'User not found' });
    const cv = (user.cvs || []).find((entry) => entry._id.toString() === req.params.cvId);
    if (!cv) return res.status(404).json({ msg: 'CV not found' });
    if ((user.applicationCVs || []).some((application) => application.cv.toString() === req.params.cvId)) return res.status(400).json({ msg: 'Change the CV on its applications before deleting it.' });
    removeFile(path.join(uploadRoot, 'cvs', cv.storedFilename));
    user.cvs = user.cvs.filter((entry) => entry._id.toString() !== req.params.cvId);
    await user.save();
    res.json({ msg: 'CV deleted' });
  } catch (err) { res.status(500).send('Server Error'); }
});

router.get('/applications', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).populate('appliedCCAs');
    if (!user) return res.status(404).json({ msg: 'User not found' });
    const applications = user.applicationCVs || [];
    res.json((user.appliedCCAs || []).map((cca) => ({ ...cca.toObject(), applicationCvId: applications.find((application) => application.cca.toString() === cca._id.toString())?.cv?.toString() || null })));
  } catch (err) { res.status(500).send('Server Error'); }
});

router.post('/applications', auth, async (req, res) => {
  try {
    const workspace = await workspaceFor();
    if (workspace.stage !== 'applications') return res.status(403).json({ msg: 'Applications are currently closed.' });
    const { ccaIds = [], applicationCVs = [] } = req.body;
    if (!Array.isArray(ccaIds) || ccaIds.length > 5 || new Set(ccaIds).size !== ccaIds.length || ccaIds.some((id) => !mongoose.isValidObjectId(id))) return res.status(400).json({ msg: 'Choose up to 5 distinct CCAs.' });
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ msg: 'User not found' });
    const requestedCCAs = await CCA.find({ _id: { $in: ccaIds }, phase1Eligible: true }).select('_id applicationDeadline');
    if (requestedCCAs.length !== ccaIds.length) return res.status(400).json({ msg: 'Choose only available Phase 1 CCAs.' });
    const validIds = new Set((user.cvs || []).map((cv) => cv._id.toString()));
    const existingApplications = new Map((user.selectionApplications || []).map((application) => [application.cca.toString(), application]));
    const previouslyApplied = new Set((user.appliedCCAs || []).map(String));
    if (requestedCCAs.some((cca) => !previouslyApplied.has(String(cca._id)) && cca.applicationDeadline && new Date(cca.applicationDeadline) < new Date())) return res.status(403).json({ msg: 'The application deadline for one of these CCAs has passed.' });
    if (!Array.isArray(applicationCVs) || applicationCVs.some((application) => !ccaIds.includes(String(application.ccaId)) || !validIds.has(String(application.cvId)))) return res.status(400).json({ msg: 'Choose one of your uploaded CVs for each application.' });
    const requestedCVs = new Map(applicationCVs.map((application) => [String(application.ccaId), String(application.cvId)]));
    const existingCVs = new Map((user.applicationCVs || []).map((application) => [String(application.cca), String(application.cv)]));
    const cvFor = (ccaId) => requestedCVs.get(ccaId) || existingCVs.get(ccaId) || String(existingApplications.get(ccaId)?.cv || '');
    if (ccaIds.some((ccaId) => !validIds.has(cvFor(ccaId)))) return res.status(400).json({ msg: 'Attach one of your uploaded CVs to every application.' });
    user.appliedCCAs = ccaIds;
    user.applicationCVs = ccaIds.map((ccaId) => ({ cca: ccaId, cv: cvFor(ccaId) }));
    const cvByCCA = new Map(user.applicationCVs.map((application) => [application.cca.toString(), application.cv]));
    user.selectionApplications = ccaIds.map((ccaId) => {
      const existing = existingApplications.get(ccaId);
      return {
        cca: ccaId,
        cv: cvByCCA.get(ccaId) || existing?.cv || null,
        vertical: existing?.vertical || 'General',
        preference: existing?.preference || 0,
        status: existing?.status || 'Applied',
        createdAt: existing?.createdAt || new Date()
      };
    });
    await user.save();
    await recordActivity(workspace, user, 'Applications saved', 'CCA applications', ccaIds.some((ccaId) => !previouslyApplied.has(ccaId)) ? 'Your application has been submitted.' : 'Your applications have been updated.');
    res.json({ msg: 'Applications saved' });
  } catch (err) { res.status(500).send('Server Error'); }
});

router.post('/rankings', auth, async (req, res) => {
  try {
    const workspace = await workspaceFor();
    if (workspace.stage !== 'applications') return res.status(403).json({ msg: 'Rankings are currently locked.' });
    const { rankedCcaIds } = req.body;
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ msg: 'User not found' });
    const applied = (user.appliedCCAs || []).map(String);
    if (!Array.isArray(rankedCcaIds) || rankedCcaIds.length !== applied.length || new Set(rankedCcaIds).size !== applied.length || rankedCcaIds.some((id) => !applied.includes(id))) return res.status(400).json({ msg: 'Rank every applied CCA exactly once.' });
    user.rankedCCAs = rankedCcaIds;
    for (const application of user.selectionApplications || []) {
      const rank = rankedCcaIds.indexOf(application.cca.toString());
      application.preference = rank === -1 ? 0 : rank + 1;
    }
    await user.save();
    await recordActivity(workspace, user, 'Preferences ranked', 'CCA applications', 'Your CCA preferences have been saved.');
    res.json({ msg: 'Ranking saved' });
  } catch (err) { res.status(500).send('Server Error'); }
});

router.post('/applications/:ccaId/vertical', auth, async (req, res) => {
  try {
    const workspace = await workspaceFor();
    if (!['applications', 'configuration', 'selection'].includes(workspace?.stage || 'applications')) return res.status(403).json({ msg: 'Vertical selection is closed.' });
    const [user, cca] = await Promise.all([User.findById(req.userId), CCA.findById(req.params.ccaId)]);
    if (!user || !cca) return res.status(404).json({ msg: 'Student or CCA not found.' });
    const application = user.selectionApplications.find((entry) => String(entry.cca) === String(cca._id));
    if (!application) return res.status(403).json({ msg: 'Apply to this CCA first.' });
    if (cca.rounds.some((round) => !isCVReview(round) && (round.startedAt || round.status === 'Active' || round.status === 'Completed'))) return res.status(403).json({ msg: 'Round 1 has started; vertical selection is locked.' });
    const vertical = cca.verticals.find((entry) => entry.name === req.body.vertical);
    if (!vertical) return res.status(400).json({ msg: 'Choose an available vertical.' });
    application.vertical = vertical.name;
    await user.save();
    await recordActivity(workspace, user, 'Preferred vertical saved', cca.name, `Preferred vertical saved for ${cca.name}: ${vertical.name}.`);
    res.json({ msg: 'Preferred vertical saved.', vertical: vertical.name });
  } catch (err) { res.status(500).json({ msg: 'Could not save the preferred vertical.' }); }
});

module.exports = router;
