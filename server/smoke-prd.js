const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const CCA = require('./models/CCA');
const SelectionWorkspace = require('./models/SelectionWorkspace');

process.env.JWT_SECRET = 'calvin-local-prd-smoke-only';
process.env.NODE_ENV = 'test';

const databaseName = `calvin_prd_smoke_${process.pid}`;
const databaseUrl = `mongodb://127.0.0.1:27017/${databaseName}`;
let server;
let smokeCvFilePath;

async function main() {
  assert.match(databaseName, /^calvin_prd_smoke_\d+$/);
  await mongoose.connect(databaseUrl);
  const app = express();
  app.use(express.json());
  app.use('/api/selection', require('./routes/selection'));
  app.use('/api/user', require('./routes/user'));
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const cca = await CCA.create({ name: 'Smoke Test CCA', description: 'Isolated workflow check', category: 'Clubs' });
  const admin = await User.create({ email: 'newuser123@example.com', password: 'test-only-password' });
  const member = await User.create({ email: 'member-smoke@example.com', password: 'test-only-password', role: 'cca', ccaAssignment: cca._id });
  const senate = await User.create({ email: 'senate-smoke@example.com', password: 'test-only-password', role: 'senate' });
  const student = await User.create({ email: 'student-smoke@example.com', password: 'test-only-password', appliedCCAs: [cca._id], selectionApplications: [{ cca: cca._id, vertical: 'General', status: 'Applied', preference: 1 }] });
  const tokenFor = (user) => jwt.sign({ userId: user.id }, process.env.JWT_SECRET);
  const request = async (user, method, route, body) => {
    const response = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json', 'x-auth-token': tokenFor(user) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    return { status: response.status, data };
  };
  const action = (user, role, name, payload) => request(user, 'POST', `/api/selection/action?previewRole=${role}`, { action: name, payload, previewRole: role });

  let response = await request(student, 'GET', '/api/selection?previewRole=senate');
  assert.equal(response.status, 200);
  assert.equal(response.data.role, 'student');
  assert.equal(response.data.previewRolesEnabled, false);

  const cvId = new mongoose.Types.ObjectId();
  const smokeCvName = `smoke-cv-${process.pid}.pdf`;
  const smokeCvFolder = path.join(__dirname, 'uploads', 'cvs', String(student._id));
  smokeCvFilePath = path.join(smokeCvFolder, smokeCvName);
  fs.mkdirSync(smokeCvFolder, { recursive: true });
  fs.writeFileSync(smokeCvFilePath, Buffer.from('%PDF-1.4\nCalvin smoke CV\n'));
  student.cvs.push({ _id: cvId, filename: 'smoke-cv.pdf', storedFilename: path.join(String(student._id), smokeCvName), mimeType: 'application/pdf', size: 12, hash: 'smoke-cv-hash' });
  student.applicationCVs.push({ cca: cca._id, cv: cvId });
  student.selectionApplications[0].cv = cvId;
  await student.save();
  response = await request(student, 'POST', '/api/user/applications', { ccaIds: [String(cca._id)], applicationCVs: [] });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const cvPreserved = await User.findById(student._id);
  assert.equal(String(cvPreserved.applicationCVs[0].cv), String(cvId));
  assert.equal(String(cvPreserved.selectionApplications[0].cv), String(cvId));

  response = await action(admin, 'admin', 'setPortalStage', { stage: 'configuration' });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await action(member, 'cca', 'configureCCA', { ccaId: String(cca._id), seats: 1, constitutionalStrength: 1, verticals: [{ name: 'General', seats: 1 }], rounds: [{ name: 'Task round', type: 'Individual · Task', maxMarks: 20, weight: 20, eliminate: 1, instructions: 'Submit a task', criteria: 'Quality' }] });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const configured = await CCA.findById(cca._id);
  const cvReviewRound = configured.rounds[0];
  assert.equal(cvReviewRound.name, 'CV review');
  assert.equal(cvReviewRound.maxMarks, 0);
  assert.equal(cvReviewRound.eliminate, 0);
  const cvReviewRoundId = String(cvReviewRound._id);
  const roundId = String(configured.rounds[1]._id);
  response = await action(member, 'cca', 'createPanel', { ccaId: String(cca._id), roundId, name: 'Panel A', members: [member.email] });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const workspace = await SelectionWorkspace.findOne({ key: 'default' });
  const panelId = workspace.panels[0].id;
  response = await action(member, 'cca', 'assignPanelStudents', { ccaId: String(cca._id), panelId, students: [String(student._id)] });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await action(member, 'cca', 'setCCAStatus', { ccaId: String(cca._id), status: 'Finalized' });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await action(admin, 'admin', 'setPortalStage', { stage: 'selection' });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const roundZeroOpen = await CCA.findById(cca._id);
  assert.equal(roundZeroOpen.currentRound, 0);
  assert.equal(roundZeroOpen.rounds[0].status, 'Active');
  assert.equal((await User.findById(student._id)).selectionApplications[0].status, 'Applied');
  response = await action(member, 'cca', 'lockEvaluation', { ccaId: String(cca._id), roundId: cvReviewRoundId, panelId, entries: [{ userId: String(student._id), total: 0 }] });
  assert.equal(response.status, 400);
  assert.match(response.data.msg, /CV review only/);
  const cvReviewState = await request(member, 'GET', `/api/selection?previewRole=cca&ccaId=${cca._id}`);
  assert.equal(cvReviewState.status, 200);
  assert.equal(cvReviewState.data.applications[0].cvId, String(cvId));
  const cvDownload = await fetch(`${base}/api/selection/cv/${cca._id}/${student._id}/${cvId}?previewRole=cca`, { headers: { 'x-auth-token': tokenFor(member) } });
  assert.equal(cvDownload.status, 200);
  assert.match(cvDownload.headers.get('content-type') || '', /application\/pdf/);
  assert.match(Buffer.from(await cvDownload.arrayBuffer()).toString(), /Calvin smoke CV/);
  const applicationExport = await fetch(`${base}/api/selection/export/${cca._id}?previewRole=cca`, { headers: { 'x-auth-token': tokenFor(member) } });
  assert.equal(applicationExport.status, 200, await applicationExport.clone().text());
  assert.match(applicationExport.headers.get('content-type') || '', /application\/zip/);
  const exportBytes = Buffer.from(await applicationExport.arrayBuffer());
  assert.equal(exportBytes.subarray(0, 2).toString(), 'PK');
  assert.ok(exportBytes.includes(Buffer.from('CVs/student_smoke-smoke-cv.pdf')));
  response = await action(member, 'cca', 'setCCAStatus', { ccaId: String(cca._id), status: 'Locked' });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const roundOneOpen = await CCA.findById(cca._id);
  assert.equal(roundOneOpen.currentRound, 1);
  assert.equal(roundOneOpen.rounds[0].status, 'Completed');
  assert.equal(roundOneOpen.rounds[1].status, 'Active');
  assert.equal((await User.findById(student._id)).selectionApplications[0].status, 'Applied');
  response = await action(student, 'student', 'submitTask', { ccaId: String(cca._id), roundId, name: 'Task', url: 'https://example.com/task' });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await action(student, 'student', 'lockEvaluation', { ccaId: String(cca._id), roundId, panelId, entries: [{ userId: String(student._id), total: 19 }] });
  assert.equal(response.status, 403);
  response = await action(member, 'cca', 'lockEvaluation', { ccaId: String(cca._id), roundId, panelId, entries: [{ userId: String(student._id), total: 19 }] });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await request(member, 'GET', `/api/selection?previewRole=cca&ccaId=${cca._id}`);
  assert.equal(response.status, 200);
  assert.equal(response.data.evaluations[0].total, undefined);
  assert.equal(response.data.applications[0].preference, undefined);
  assert.equal(response.data.applications[0].cvId, String(cvId));
  response = await request(student, 'GET', '/api/selection?previewRole=senate');
  assert.deepEqual(response.data.evaluations, []);
  const studentAudit = await fetch(`${base}/api/selection/audit-export`, { headers: { 'x-auth-token': tokenFor(student) } });
  assert.equal(studentAudit.status, 403);
  const senateAudit = await fetch(`${base}/api/selection/audit-export`, { headers: { 'x-auth-token': tokenFor(senate) } });
  assert.equal(senateAudit.status, 200);
  assert.match(await senateAudit.text(), /Evaluations locked/);
  response = await action(member, 'cca', 'completeRound', { ccaId: String(cca._id), roundId, eliminate: 0 });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  response = await action(senate, 'senate', 'ratifyResults', { ccaId: String(cca._id) });
  assert.equal(response.status, 200, JSON.stringify(response.data));
  const selected = await User.findById(student._id);
  assert.equal(selected.selectionApplications[0].status, 'Selected');
  const institutionalAdmin = await User.create({ email: 'km@iiml.ac.in', password: 'test-only-password' });
  process.env.NODE_ENV = 'production';
  response = await request(institutionalAdmin, 'GET', '/api/selection?previewRole=admin');
  assert.equal(response.status, 200);
  assert.equal(response.data.role, 'admin');
  assert.equal(response.data.isPortalAdmin, true);
  response = await request(institutionalAdmin, 'GET', '/api/selection?previewRole=senate');
  assert.equal(response.data.role, 'senate');
  response = await request(student, 'GET', '/api/selection?previewRole=admin');
  assert.equal(response.data.role, 'student');
  process.env.NODE_ENV = 'test';
  console.log('PRD smoke test passed: roles, admin access, CV preservation and export, non-eliminative Round 0 application review, Round 1 transition, configuration, panel assignment, submission, locked scores, round completion, and ratification.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (smokeCvFilePath) {
    try { fs.unlinkSync(smokeCvFilePath); } catch { /* The smoke test may have failed before the file was created. */ }
    try { fs.rmdirSync(path.dirname(smokeCvFilePath)); } catch { /* Keep the user CV folder if it contains other files. */ }
  }
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState === 1 && mongoose.connection.name === databaseName) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
