import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Alert, AppBar, Avatar, Badge, Box, Button, Card, CardContent, Chip, CircularProgress, Link,
  Container, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Drawer, FormControl, FormHelperText,
  Grid, IconButton, InputLabel, List, ListItemButton, ListItemIcon, ListItemText, MenuItem,
  Paper, Select, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField,
  Toolbar, Tooltip, Typography
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import GroupsIcon from '@mui/icons-material/Groups';
import EventIcon from '@mui/icons-material/Event';
import GavelIcon from '@mui/icons-material/Gavel';
import HistoryIcon from '@mui/icons-material/History';
import SettingsIcon from '@mui/icons-material/Settings';
import AssignmentIcon from '@mui/icons-material/Assignment';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import NotificationsIcon from '@mui/icons-material/Notifications';
import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

const API = '/api/selection';
const drawerWidth = 238;
const roundTypes = ['Individual · Task', 'Individual · Task + Interview', 'Individual · Interview', 'Group · Task', 'Group · Task + Interview', 'Group · Interview'];
const interviewRoundTypes = new Set(roundTypes.filter((type) => type.includes('Interview')));
const CV_REVIEW_TYPE = 'CV Review · No elimination';
const isCVReview = (round) => round?.type === CV_REVIEW_TYPE;
const isInterview = (round) => interviewRoundTypes.has(round?.type);
const roleViews = {
  senate: ['Overview', 'CCA directory', 'Scores & results', 'Live interviews', 'Exceptions & alerts', 'Audit trail', 'Policy & access'],
  admin: ['Admin home', 'Event flags', 'Control levels', 'Manage data', 'Audit trail'],
  cca: ['My CCA', 'Selection structure', 'View applications', 'Panels & interviews', 'Evaluations', 'Results'],
  student: ['My applications', 'Explore CCAs', 'My schedule']
};
const viewIcons = { Overview: DashboardIcon, 'Admin home': DashboardIcon, 'Event flags': EventIcon, 'Control levels': SettingsIcon, 'Manage data': AssignmentIcon, 'CCA directory': GroupsIcon, 'Scores & results': FactCheckIcon, 'Live interviews': EventIcon, 'Exceptions & alerts': GavelIcon, 'Audit trail': HistoryIcon, 'Policy & access': SettingsIcon, 'My CCA': DashboardIcon, 'Selection structure': SettingsIcon, 'View applications': GroupsIcon, 'Panels & interviews': EventIcon, Evaluations: FactCheckIcon, Results: AssignmentIcon, 'My applications': AssignmentIcon, 'Explore CCAs': GroupsIcon, 'My schedule': EventIcon };
const adminControlLabels = { tasks: 'Tasks', interviews: 'Interviews', evaluations: 'Evaluations', results: 'Results publishing' };
const statusColor = (status) => status === 'Completed' || status === 'Selected' || status === 'Resolved' ? 'success' : status === 'Eliminated' || status === 'Open' ? 'error' : status === 'Applications open' || status === 'Participating' ? 'primary' : 'default';
const formatDate = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Not set';
const stageInfo = {
  applications: { label: 'Applications & round building', detail: 'Students can apply and rank CCAs while CCAs build and finalize their rounds and interview panels.', color: 'success' },
  configuration: { label: 'Internal setup', detail: 'Applications are frozen while Senate finalizes seats and policy; CCAs can continue round and panel setup.', color: 'warning' },
  selection: { label: 'Selection workspace open', detail: 'Students and CCAs can use tasks, interviews, evaluations, and results workflows.', color: 'primary' },
  completed: { label: 'Cycle completed', detail: 'The cycle is read-only and published results remain visible.', color: 'secondary' }
};

const StatCard = ({ label, value, detail }) => (
  <Card sx={{ height: '100%', borderTop: '4px solid', borderColor: 'primary.main' }}>
    <CardContent><Typography color="text.secondary" variant="body2">{label}</Typography><Typography variant="h3" sx={{ my: 1 }}>{value}</Typography><Typography variant="caption" color="text.secondary">{detail}</Typography></CardContent>
  </Card>
);

const Empty = ({ children }) => <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>{children}</Paper>;

const RoundEditor = ({ round, onChange, structureBuilt, onUpload, uploadBusy }) => {
  const set = (field, value) => onChange({ ...round, [field]: value });
  return <Stack spacing={1.5}>
    <TextField disabled={structureBuilt} label="Round name" value={round.name || ''} onChange={(event) => set('name', event.target.value)} />
    <FormControl disabled={structureBuilt}><InputLabel>Round type</InputLabel><Select label="Round type" value={round.type || roundTypes[0]} onChange={(event) => set('type', event.target.value)}>{roundTypes.map((type) => <MenuItem value={type} key={type}>{type}</MenuItem>)}</Select></FormControl>
    <Grid container spacing={1}><Grid size={{ xs: 12, sm: 4 }}><TextField disabled={structureBuilt} fullWidth label="Maximum marks" type="number" value={round.maxMarks ?? ''} onChange={(event) => set('maxMarks', Number(event.target.value))} /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField disabled={structureBuilt} fullWidth label="Weight" type="number" value={round.weight ?? ''} onChange={(event) => set('weight', Number(event.target.value))} /></Grid></Grid>
    {round.type?.includes('Task + Interview') && <Grid container spacing={1}><Grid size={{ xs: 6 }}><TextField disabled={structureBuilt} fullWidth label="Task maximum" type="number" value={round.taskMaxMarks ?? ''} onChange={(event) => set('taskMaxMarks', Number(event.target.value))} /></Grid><Grid size={{ xs: 6 }}><TextField disabled={structureBuilt} fullWidth label="Interview maximum" type="number" value={round.interviewMaxMarks ?? ''} onChange={(event) => set('interviewMaxMarks', Number(event.target.value))} /></Grid></Grid>}
    <TextField label="Scheduled start" type="datetime-local" InputLabelProps={{ shrink: true }} value={round.startAt || ''} onChange={(event) => set('startAt', event.target.value)} helperText="You can update the timing until this round starts." />
    <TextField label="Task deadline" type="datetime-local" InputLabelProps={{ shrink: true }} value={round.deadline || ''} onChange={(event) => set('deadline', event.target.value)} />
    <TextField label="Student instructions" multiline minRows={2} value={round.instructions || ''} onChange={(event) => set('instructions', event.target.value)} />
    <TextField disabled={structureBuilt} label="Scoring rubric and evaluation criteria" multiline minRows={4} value={round.criteria || ''} onChange={(event) => set('criteria', event.target.value)} helperText={structureBuilt ? 'The rubric is fixed after round building is complete.' : 'Set the scoring criteria before finalizing the round structure.'} />
    <Box><Typography variant="subtitle2" sx={{ mb: 1 }}>Round documents</Typography><Button component="label" variant="outlined" disabled={uploadBusy}>{uploadBusy ? 'Uploading…' : 'Upload document or PDF'}<input hidden type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.zip" onChange={(event) => { onUpload(event.target.files?.[0]); event.target.value = ''; }} /></Button>{(round.documents || []).map((document) => <Stack direction="row" alignItems="center" spacing={1} key={document.fileKey} sx={{ mt: 1 }}><Typography variant="body2" sx={{ flex: 1 }}>{document.name}</Typography><Button size="small" color="error" onClick={() => set('documents', round.documents.filter((item) => item.fileKey !== document.fileKey))}>Remove</Button></Stack>)}</Box>
  </Stack>;
};
const localDateTimeValue = (value) => { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const roundFormFrom = (round = {}, index = 0) => ({ _id: round._id, name: round.name || `Round ${index + 1}`, type: round.type || roundTypes[0], maxMarks: round.maxMarks ?? 20, taskMaxMarks: round.taskMaxMarks ?? 20, interviewMaxMarks: round.interviewMaxMarks ?? 0, weight: round.weight ?? 20, startAt: localDateTimeValue(round.startAt), deadline: localDateTimeValue(round.deadline), instructions: round.instructions || '', criteria: round.criteria || '', documents: round.documents || [] });

const LinkedText = ({ children, sx }) => {
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const parts = String(children || '').split(urlPattern);
  return <Typography component="div" sx={{ whiteSpace: 'pre-line', ...sx }}>{parts.map((part, index) => /^https?:\/\//i.test(part) ? <Link key={index} href={part.replace(/[),.;!?]+$/, '')} target="_blank" rel="noopener noreferrer">{part}</Link> : part)}</Typography>;
};

const SelectionWorkspacePage = () => {
  const navigate = useNavigate();
  const [role, setRole] = useState('student');
  const [view, setView] = useState('My applications');
  const [ccaId, setCcaId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [uploadBusy, setUploadBusy] = useState(false);
  const [eventFlagsForm, setEventFlagsForm] = useState(null);
  const [eventFlagsDirty, setEventFlagsDirty] = useState(false);
  const [cvPreview, setCvPreview] = useState(null);
  const [panelRoundId, setPanelRoundId] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('token');
    setLoading(true);
    try {
      const params = new URLSearchParams({ previewRole: role });
      if (ccaId) params.set('ccaId', ccaId);
      const response = await axios.get(`${API}?${params}`, { headers: { 'x-auth-token': token } });
      setData(response.data);
      if (!response.data.previewRolesEnabled && role !== response.data.role) setRole(response.data.role);
      if (response.data.isPortalAdmin && !response.data.previewRolesEnabled && role === 'student') setRole('admin');
      setError('');
      if (!ccaId && response.data.ccaId) setCcaId(response.data.ccaId);
    } catch (err) {
      if (err.response?.status === 401) { localStorage.removeItem('token'); navigate('/login', { replace: true }); return; }
      setError(err.response?.data?.msg || 'Could not load the selection workspace.');
    } finally { setLoading(false); }
  }, [role, ccaId, navigate]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const timer = window.setInterval(load, 15000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => { const views = roleViews[role]; if (!views.includes(view)) setView(views[0]); }, [role, view]);

  const act = async (action, payload = {}) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.post(`${API}/action?previewRole=${role}`, { action, payload, previewRole: role }, { headers: { 'x-auth-token': token } });
      setModal(null); setForm({}); await load();
      return response.data;
    } catch (err) { setError(err.response?.data?.msg || 'Could not save that change.'); }
    return null;
  };

  const ccas = data?.ccas || [];
  const allCCAs = data?.allCCAs || [];
  const applications = data?.applications || [];
  const panelMembers = data?.panelMembers || [];
  const currentCCA = ccas.find((cca) => cca._id === (data?.ccaId || ccaId)) || ccas[0];
  const ccaCoreLocked = currentCCA?.selectionStatus !== 'Draft';
  const currentRound = currentCCA?.rounds?.[currentCCA.currentRound || 0];
  const interviewRounds = currentCCA?.rounds?.filter(isInterview) || [];
  const firstInterviewRound = interviewRounds[0];
  const panelRound = interviewRounds.find((round) => String(round._id) === String(panelRoundId))
    || (isInterview(currentRound) ? currentRound : firstInterviewRound);
  const roundPanels = (data?.panels || []).filter((panel) => panel.ccaId === String(currentCCA?._id) && panel.roundId === String(panelRound?._id));
  const canEditRound = (round) => round.status !== 'Completed' && !(round.startAt ? Date.now() >= new Date(round.startAt).getTime() : round.status === 'Active');
  const openExceptions = (data?.exceptions || []).filter((item) => item.status === 'Open');
  const unread = (data?.notifications || []).filter((item) => !(item.readBy || []).includes(data?.currentUser?.id)).length;
  const portalStage = data?.stage || 'applications';
  const currentStage = stageInfo[portalStage];
  const canControlPortal = ['senate', 'admin'].includes(role) && Boolean(data?.isPortalAdmin);

  useEffect(() => {
    if (!data || eventFlagsDirty) return;
    setEventFlagsForm(Object.fromEntries(['applications', 'configuration', 'selection'].map((stage) => {
      const saved = data.portalSchedule?.[stage] || {};
      return [stage, {
        enabled: saved.enabled ?? stage === portalStage,
        start: saved.start ? new Date(saved.start).toISOString().slice(0, 16) : '',
        end: saved.end ? new Date(saved.end).toISOString().slice(0, 16) : ''
      }];
    })));
  }, [data, eventFlagsDirty, portalStage]);

  const openModal = (type, initial = {}) => { setForm(initial); setModal(type); };
  const updateScore = (index, field, value) => setForm((current) => ({ ...current, entries: current.entries.map((entry, itemIndex) => {
    if (itemIndex !== index) return entry;
    const next = { ...entry, [field]: value };
    if (field !== 'total') next.total = next.taskScore !== '' && next.interviewScore !== '' ? Number(next.taskScore) + Number(next.interviewScore) : '';
    return next;
  }) }));
  const uploadTaskFile = async (file) => {
    if (!file) return;
    setUploadBusy(true);
    try {
      const token = localStorage.getItem('token');
      const body = new FormData();
      body.append('file', file);
      const response = await axios.post(`${API}/submission-file`, body, { headers: { 'x-auth-token': token } });
      setForm((current) => ({ ...current, fileKey: response.data.fileKey, filename: response.data.filename, name: current.name || response.data.filename, url: '' }));
      setError('');
    } catch (err) {
      setError(err.response?.data?.msg || 'Could not upload the task file.');
    } finally { setUploadBusy(false); }
  };
  const uploadRoundDocument = async (file) => {
    if (!file) return;
    setUploadBusy(true);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('previewRole', role);
      const token = localStorage.getItem('token');
      const response = await axios.post(`${API}/round-file`, body, { headers: { 'x-auth-token': token } });
      setForm((current) => ({ ...current, documents: [...(current.documents || []), { name: response.data.name, fileKey: response.data.fileKey }] }));
      setError('');
    } catch (err) {
      setError(err.response?.data?.msg || 'Could not upload the round document.');
    } finally { setUploadBusy(false); }
  };
  const openSubmission = async (submission) => {
    if (submission.url) { window.open(submission.url, '_blank', 'noopener,noreferrer'); return; }
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams({ previewRole: role });
      if (submission.ccaId) params.set('ccaId', submission.ccaId);
      const response = await axios.get(`${API}/submission-file/${submission.fileKey}?${params}`, { headers: { 'x-auth-token': token }, responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = url; link.download = submission.filename || 'submission'; link.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err.response?.data?.msg || 'Could not open that submission.'); }
  };
  const configureInitial = () => ({
    ccaId: currentCCA._id,
    seats: currentCCA.seats || 4,
    constitutionalStrength: currentCCA.constitutionalStrength || currentCCA.seats || 4,
    description: currentCCA.description || '',
    contactPerson: currentCCA.contactPerson || '',
    selectionCoordinators: (currentCCA.selectionCoordinators || []).join('\n'),
    applicationDeadline: currentCCA.applicationDeadline ? new Date(currentCCA.applicationDeadline).toISOString().slice(0, 16) : '',
    verticals: currentCCA.verticals?.length ? currentCCA.verticals : [{ name: 'General', seats: currentCCA.seats || 4 }],
  });
  const portalScheduleInitial = () => ({ schedule: Object.fromEntries(['applications', 'configuration', 'selection'].map((stage) => [stage, { start: data?.portalSchedule?.[stage]?.start ? new Date(data.portalSchedule[stage].start).toISOString().slice(0, 16) : '', end: data?.portalSchedule?.[stage]?.end ? new Date(data.portalSchedule[stage].end).toISOString().slice(0, 16) : '' }])) });

  const saveConfiguration = () => act('configureCCA', { ...form, applicationDeadline: form.applicationDeadline ? new Date(form.applicationDeadline).toISOString() : null });
  const saveRound = () => act(form._id ? 'editScoredRound' : 'addScoredRound', { ccaId: currentCCA._id, roundId: form._id, round: { ...form, startAt: form.startAt ? new Date(form.startAt).toISOString() : null, deadline: form.deadline ? new Date(form.deadline).toISOString() : null } });
  const openRoundDocument = async (roundDocument) => {
    const tab = window.open('about:blank', '_blank');
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`${API}/round-file/${encodeURIComponent(roundDocument.fileKey)}?previewRole=${role}`, { headers: { 'x-auth-token': token }, responseType: 'blob' });
      const url = URL.createObjectURL(response.data);
      if (tab) tab.location.href = url;
      else { const link = window.document.createElement('a'); link.href = url; link.download = roundDocument.name || 'round-document'; link.click(); }
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) { tab?.close(); setError(err.response?.data?.msg || 'Could not open that round document.'); }
  };
  const savePortalSchedule = () => act('updatePortalSchedule', { schedule: Object.fromEntries(Object.entries(form.schedule || {}).map(([stage, window]) => [stage, { start: window.start ? new Date(window.start).toISOString() : null, end: window.end ? new Date(window.end).toISOString() : null }])) });
  const saveEventFlags = async () => {
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API}/action?previewRole=${role}`, {
        action: 'updatePortalSchedule',
        payload: {
          flags: eventFlagsForm,
          schedule: Object.fromEntries(Object.entries(eventFlagsForm || {}).map(([stage, window]) => [stage, {
            start: window.start ? new Date(window.start).toISOString() : null,
            end: window.end ? new Date(window.end).toISOString() : null
          }]))
        },
        previewRole: role
      }, { headers: { 'x-auth-token': token } });
      setEventFlagsDirty(false);
      setError('');
      await load();
    } catch (err) {
      setError(err.response?.data?.msg || 'Could not update the event flags.');
    }
  };
  const downloadBlob = async (url, filename) => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(url, { headers: { 'x-auth-token': token }, responseType: 'blob' });
      const objectUrl = URL.createObjectURL(response.data);
      const link = document.createElement('a');
      link.href = objectUrl; link.download = filename; link.style.display = 'none';
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (err) {
      let message = err.response?.data?.msg;
      if (!message && err.response?.data instanceof Blob) {
        try { message = JSON.parse(await err.response.data.text()).msg; } catch { /* Use the standard message below. */ }
      }
      setError(message || 'Could not download that file.');
    }
  };
  const applicantCvUrl = (application) => `${API}/cv/${application.ccaId}/${application.userId}/${application.cvId}?previewRole=${role}`;
  const downloadApplicantCv = (application) => downloadBlob(applicantCvUrl(application), application.cvFilename || 'CV');
  const viewApplicantCv = async (application) => {
    setCvPreview({ application, loading: true });
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(applicantCvUrl(application), { headers: { 'x-auth-token': token }, responseType: 'blob' });
      const isPdf = response.data.type === 'application/pdf' || application.cvFilename?.toLowerCase().endsWith('.pdf');
      const previewBlob = new Blob([response.data], { type: isPdf ? 'application/pdf' : response.data.type });
      setCvPreview({ application, url: URL.createObjectURL(previewBlob), isPdf });
    } catch (err) {
      setCvPreview(null);
      setError(err.response?.status === 404 ? 'This CV file is missing from local storage. Ask the applicant to upload it again.' : err.response?.data?.msg || 'Could not open this CV.');
    }
  };
  useEffect(() => () => { if (cvPreview?.url) URL.revokeObjectURL(cvPreview.url); }, [cvPreview?.url]);
  const downloadCCAExport = (cca) => downloadBlob(`${API}/export/${cca?._id}?previewRole=${role}`, `${cca?.name || 'CCA'}-applications.zip`);
  const downloadApplicantExport = () => downloadCCAExport(currentCCA);
  const chooseVertical = async (application, vertical) => {
    try {
      const token = localStorage.getItem('token');
      await axios.post(`/api/user/applications/${application.ccaId}/vertical`, { vertical }, { headers: { 'x-auth-token': token } });
      await load();
    } catch (err) { setError(err.response?.data?.msg || 'Could not save your preferred vertical.'); }
  };

  const applicationRows = (rows = applications) => (
    <Paper variant="outlined" sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow><TableCell>Student</TableCell><TableCell>CCA</TableCell><TableCell>Vertical</TableCell>{role !== 'cca' && <TableCell>Preference</TableCell>}<TableCell>Status</TableCell>{role !== 'student' && <TableCell>CV</TableCell>}</TableRow></TableHead><TableBody>{rows.map((application) => <TableRow key={application.id}><TableCell><strong>{application.studentName}</strong><Typography variant="caption" display="block">{application.email}</Typography></TableCell><TableCell>{allCCAs.find((cca) => cca._id === application.ccaId)?.name || currentCCA?.name}</TableCell><TableCell>{application.vertical}</TableCell>{role !== 'cca' && <TableCell>{application.preference || '—'}</TableCell>}<TableCell><Chip size="small" color={statusColor(application.status)} label={application.status} /></TableCell>{role !== 'student' && <TableCell>{['selection', 'completed'].includes(portalStage) && application.cvId ? <Stack direction="row" spacing={0.5}><Button size="small" onClick={() => viewApplicantCv(application)}>View CV</Button><Button size="small" onClick={() => downloadApplicantCv(application)}>Download</Button></Stack> : <Typography variant="caption" color="text.secondary">Available when selection opens</Typography>}</TableCell>}</TableRow>)}</TableBody></Table>{!rows.length && <Box sx={{ p: 3 }}><Empty>No applications yet.</Empty></Box>}</Paper>
  );

  const sessionCards = (data?.sessions || []).length ? <Grid container spacing={2}>{data.sessions.map((session) => {
    const interviewRound = ccas.find((item) => item._id === session.ccaId)?.rounds.find((item) => item._id === session.roundId);
    const entered = session.entered?.includes(data.currentUser.id);
    return <Grid size={{ xs: 12, md: 6 }} key={session.id}><Card><CardContent><Stack direction="row" justifyContent="space-between"><Typography variant="h6">{allCCAs.find((item) => item._id === session.ccaId)?.name || 'Interview'}</Typography><Chip size="small" label={session.status} color={statusColor(session.status)} /></Stack><Typography sx={{ mt: 1 }}>{session.students.map((student) => data.students.find((item) => item.id === student)?.name || student).join(', ')}</Typography><Typography variant="body2" color="text.secondary">{formatDate(session.time)} · {session.location}</Typography>{role === 'student' && <Stack direction="row" spacing={1} sx={{ mt: 2 }}><Button variant="contained" disabled={entered || !['Scheduled', 'Waiting for panel', 'Waiting for student'].includes(session.status)} onClick={() => act('transitionSession', { sessionId: session.id, transition: 'studentEnter' })}>Enter</Button><Button variant="outlined" disabled={!entered || session.status !== 'Active'} onClick={() => act('transitionSession', { sessionId: session.id, transition: 'studentExit' })}>Complete & exit</Button></Stack>}{role === 'cca' && <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}><Button variant="outlined" disabled={!['Scheduled', 'Waiting for panel'].includes(session.status)} onClick={() => act('transitionSession', { sessionId: session.id, transition: 'panelEnter' })}>Panel enter</Button><Button variant="outlined" disabled={session.status !== 'Evaluation pending'} onClick={() => openModal(interviewRound?.type.startsWith('Screening') ? 'screen' : 'evaluate', interviewRound?.type.startsWith('Screening') ? { ccaId: session.ccaId, roundId: session.roundId, panelId: session.panelId, sessionId: session.id, decisions: session.students.map((userId) => ({ userId, decision: 'Promoted', sessionId: session.id })) } : { ccaId: session.ccaId, roundId: session.roundId, panelId: session.panelId, sessionId: session.id, entries: session.students.map((userId) => ({ userId, total: '' })) })}>Evaluate</Button><Button variant="outlined" disabled={session.status !== 'Marks locked'} onClick={() => act('transitionSession', { sessionId: session.id, transition: 'panelExit' })}>Panel exit</Button><Button variant="outlined" color="error" onClick={() => openModal('exception', { ccaId: session.ccaId, sessionId: session.id, reason: '' })}>Raise exception</Button></Stack>}</CardContent></Card></Grid>;
  })}</Grid> : <Empty>No interviews scheduled.</Empty>;

  const panelRunCards = (data?.panelRuns || []).length ? <Stack spacing={2}>{data.panelRuns.slice().reverse().map((run) => {
    const runCCA = allCCAs.find((item) => item._id === run.ccaId);
    const ownAttendance = run.students?.find((item) => String(item.userId) === String(data.currentUser.id));
    const runRound = ccas.find((item) => item._id === run.ccaId)?.rounds.find((item) => item._id === run.roundId);
    const runPanel = (data.panels || []).find((item) => item.id === run.panelId);
    const canManagePanel = role === 'cca' && runPanel?.members?.includes(data.currentUser.email);
    const attendanceLabel = (entry) => entry.evaluationId ? 'Marks submitted' : entry.ccaOutAt ? 'Waiting for marks' : entry.studentInAt ? 'Student in' : 'Waiting for student confirmation';
    return <Paper variant="outlined" sx={{ p: 2 }} key={run.id}>
      <Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="h6">{run.roundName} · {run.panelName}</Typography><Typography variant="body2" color="text.secondary">{runCCA?.name} · Started {formatDate(run.startedAt)}{run.lateMinutes ? ` · Running ${run.lateMinutes} min late` : ''}</Typography></Box><Chip color={run.status === 'Active' ? 'success' : 'default'} label={run.status === 'Active' ? 'Panel started' : 'Panel complete'} /></Stack>
      {role === 'student' ? <Box sx={{ mt: 1 }}>{ownAttendance ? <><Typography>{ownAttendance.ccaOutAt ? 'Your interview is complete.' : ownAttendance.studentInAt ? 'Your attendance is confirmed.' : 'The CCA has called you in.'}</Typography>{ownAttendance.ccaInAt && !ownAttendance.studentInAt && <Button sx={{ mt: 1 }} variant="contained" onClick={() => act('panelAttendance', { panelRunId: run.id, transition: 'studentIn' })}>Confirm attendance in</Button>}{ownAttendance.ccaOutAt && !ownAttendance.studentOutAt && <Button sx={{ mt: 1 }} variant="contained" onClick={() => act('panelAttendance', { panelRunId: run.id, transition: 'studentOut' })}>Mark attendance out</Button>}{ownAttendance.studentOutAt && <Chip sx={{ mt: 1 }} color="success" label="Attendance out recorded" />}</> : <Typography sx={{ mt: 1 }}>The panel is active. Wait for the CCA to call you.</Typography>}</Box> : <>
        <Stack spacing={1} sx={{ mt: 2 }}>{(run.students || []).map((entry) => <Paper variant="outlined" sx={{ p: 1.5 }} key={entry.userId}><Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between" spacing={1}><Box><strong>{entry.studentName}</strong><Typography variant="caption" display="block">{attendanceLabel(entry)} · CCA in {formatDate(entry.ccaInAt)} · Student in {formatDate(entry.studentInAt)}{entry.ccaOutAt ? ` · CCA out ${formatDate(entry.ccaOutAt)}` : ''}{entry.studentOutAt ? ` · Student out ${formatDate(entry.studentOutAt)}` : ''}</Typography></Box><Stack direction="row" spacing={1}>
          {canManagePanel && !entry.ccaOutAt && entry.studentInAt && <Button size="small" variant="outlined" onClick={async () => { const result = await act('panelAttendance', { panelRunId: run.id, userId: entry.userId, transition: 'ccaOut' }); if (result?.openScoreEntry) openModal('panelScore', { ...result.openScoreEntry, total: '', taskScore: '', interviewScore: '', isEditing: false }); }}>Mark student out & score</Button>}
          {canManagePanel && entry.ccaOutAt && !entry.evaluationId && <Button size="small" variant="contained" onClick={() => openModal('panelScore', { ccaId: run.ccaId, panelRunId: run.id, panelId: run.panelId, roundId: run.roundId, userId: entry.userId, studentName: entry.studentName, scoreDueAt: entry.scoreDueAt, total: '', taskScore: '', interviewScore: '', isEditing: false })}>Enter marks · due {formatDate(entry.scoreDueAt)}</Button>}
          {canManagePanel && entry.evaluationId && entry.scoreEditUntil && Date.now() <= Date.parse(entry.scoreEditUntil) && <Button size="small" onClick={() => openModal('panelScore', { ccaId: run.ccaId, panelRunId: run.id, panelId: run.panelId, roundId: run.roundId, userId: entry.userId, studentName: entry.studentName, scoreDueAt: entry.scoreDueAt, total: '', taskScore: '', interviewScore: '', isEditing: true })}>Edit marks · 2-minute window</Button>}
          {canManagePanel && entry.evaluationId && (!entry.scoreEditUntil || Date.now() > Date.parse(entry.scoreEditUntil)) && <Chip size="small" label="Marks locked" />}
        </Stack></Stack></Paper>)}</Stack>
        {run.status === 'Active' && canManagePanel && <Stack direction="row" spacing={1} sx={{ mt: 2 }}><Button size="small" variant="contained" disabled={!run.students?.length || run.students.some((entry) => !entry.ccaOutAt || !entry.evaluationId)} onClick={() => act('finishPanelRun', { panelRunId: run.id })}>CCA panel sign out</Button><Button size="small" variant="outlined" onClick={() => openModal('panelMarkIn', { panelRunId: run.id, userId: '' })}>Mark student in</Button></Stack>}
      </>}
      {role === 'student' && runRound && ownAttendance && <Typography variant="caption" display="block" sx={{ mt: 1 }}>{runRound.name} · {runRound.maxMarks} maximum marks</Typography>}
    </Paper>;
  })}</Stack> : null;

  const panelCandidates = (run) => applications.filter((application) =>
    ['Applied', 'Participating'].includes(application.status)
    && !(data.evaluations || []).some((evaluation) => evaluation.ccaId === run?.ccaId && evaluation.roundId === run?.roundId && evaluation.userId === application.userId)
    && !(data.screeningDecisions || []).some((decision) => decision.ccaId === run?.ccaId && decision.roundId === run?.roundId && decision.userId === application.userId)
    && !(data.panelRuns || []).some((other) => other.ccaId === run?.ccaId && other.roundId === run?.roundId && other.students?.some((entry) => entry.userId === application.userId))
  );

  const renderContent = () => {
    if (!data) return null;
    if (role === 'admin' && view === 'Event flags') return !eventFlagsForm ? <CircularProgress /> : <Stack spacing={2}><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="h5">Event flags</Typography><Typography color="text.secondary">Enable or disable each portal phase and set its timing directly here.</Typography></Box><Chip color="info" label={`Live phase: ${stageInfo[portalStage]?.label || portalStage}`} /></Stack><Alert severity="info">These settings are saved together. The current live phase is shown separately from the next enabled or disabled setting; testing mode: switch to any phase at any time. Timing fields are saved for later and do not restrict access.</Alert><Paper variant="outlined" sx={{ overflowX: 'auto' }}><Table><TableHead><TableRow><TableCell>Event</TableCell><TableCell>Current status</TableCell><TableCell>Set new value</TableCell><TableCell>Phase timing</TableCell><TableCell>Action</TableCell></TableRow></TableHead><TableBody>{['applications', 'configuration', 'selection'].map((stage) => { const flag = eventFlagsForm[stage]; const canOpen = true; return <TableRow key={stage}><TableCell><strong>{stageInfo[stage].label}</strong><Typography variant="caption" display="block">{stageInfo[stage].detail}</Typography></TableCell><TableCell><Chip size="small" label={portalStage === stage ? 'Enabled' : 'Disabled'} color={portalStage === stage ? 'success' : 'default'} /></TableCell><TableCell><FormControl size="small" sx={{ minWidth: 130 }}><Select value={flag.enabled ? 'enabled' : 'disabled'} onChange={(event) => { setEventFlagsDirty(true); setEventFlagsForm((current) => ({ ...current, [stage]: { ...current[stage], enabled: event.target.value === 'enabled' } })); }}><MenuItem value="enabled">Enable</MenuItem><MenuItem value="disabled">Disable</MenuItem></Select></FormControl></TableCell><TableCell><Stack direction={{ xs: 'column', md: 'row' }} spacing={1}><TextField size="small" label="Start" type="datetime-local" InputLabelProps={{ shrink: true }} value={flag.start} onChange={(event) => { setEventFlagsDirty(true); setEventFlagsForm((current) => ({ ...current, [stage]: { ...current[stage], start: event.target.value } })); }} /><TextField size="small" label="End" type="datetime-local" InputLabelProps={{ shrink: true }} value={flag.end} onChange={(event) => { setEventFlagsDirty(true); setEventFlagsForm((current) => ({ ...current, [stage]: { ...current[stage], end: event.target.value } })); }} /></Stack></TableCell><TableCell>{canOpen && <Button size="small" variant="contained" onClick={() => openModal('stage', { stage })}>Open phase</Button>}</TableCell></TableRow>; })}<TableRow><TableCell><strong>Completed results</strong><Typography variant="caption" display="block">Freeze the cycle as read-only.</Typography></TableCell><TableCell><Chip size="small" label={portalStage === 'completed' ? 'Enabled' : 'Disabled'} color={portalStage === 'completed' ? 'success' : 'default'} /></TableCell><TableCell colSpan={2}><Typography variant="caption" color="text.secondary">No timing window; trigger after all CCA results are ratified.</Typography></TableCell><TableCell><Button size="small" variant="contained" color="success" onClick={() => openModal('stage', { stage: 'completed' })}>Open phase</Button></TableCell></TableRow></TableBody></Table></Paper><Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={2}><Typography variant="caption" color="text.secondary">{eventFlagsDirty ? 'Unsaved changes' : 'All event flags saved'}</Typography><Button variant="contained" disabled={!eventFlagsDirty} onClick={saveEventFlags}>Update event flags</Button></Stack></Stack>;
    if (role === 'admin' && view === 'Admin home') return <><Grid container spacing={2}><Grid size={{ xs: 12, sm: 6, md: 3 }}><StatCard label="Portal stage" value={currentStage.label} detail="Administrator-controlled lifecycle" /></Grid><Grid size={{ xs: 12, sm: 6, md: 3 }}><StatCard label="CCAs" value={ccas.length} detail="Configured directory records" /></Grid><Grid size={{ xs: 12, sm: 6, md: 3 }}><StatCard label="Applications" value={applications.length} detail="Visible across the portal" /></Grid><Grid size={{ xs: 12, sm: 6, md: 3 }}><StatCard label="Open alerts" value={openExceptions.length} detail="Exceptions needing attention" /></Grid></Grid><Card sx={{ mt: 3 }}><CardContent><Typography variant="h5">Administrator checklist</Typography><List><ListItemButton onClick={() => setView('Event flags')}><ListItemIcon><EventIcon /></ListItemIcon><ListItemText primary="Open or close a portal phase" secondary="Applications, internal setup, selection workspace, and completed results" /></ListItemButton><ListItemButton onClick={() => setView('Control levels')}><ListItemIcon><SettingsIcon /></ListItemIcon><ListItemText primary="Control CCA operations" secondary="Enable or disable tasks, interviews, evaluations, and result publishing per CCA" /></ListItemButton><ListItemButton onClick={() => setView('Manage data')}><ListItemIcon><AssignmentIcon /></ListItemIcon><ListItemText primary="Manage application data" secondary="Download application packs, review access, and inspect the audit trail" /></ListItemButton></List></CardContent></Card></>;
    if (role === 'admin' && view === 'Event flags') return <><Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}><Box><Typography variant="h5">Event flags</Typography><Typography color="text.secondary">The admin is the only role that can trigger these events.</Typography></Box><Button variant="outlined" onClick={() => openModal('schedulePortal', portalScheduleInitial())}>Edit phase timings</Button></Stack><Paper variant="outlined"><Table><TableHead><TableRow><TableCell>Event</TableCell><TableCell>Current status</TableCell><TableCell>Scheduled window</TableCell><TableCell>Action</TableCell></TableRow></TableHead><TableBody>{['applications', 'configuration', 'selection'].map((stage) => { const window = data.portalSchedule?.[stage] || {}; const canOpen = (stage === 'configuration' && portalStage === 'applications') || (stage === 'selection' && portalStage === 'configuration') || (stage === 'completed' && portalStage === 'selection'); return <TableRow key={stage}><TableCell><strong>{stageInfo[stage]?.label || 'Completed'}</strong><Typography variant="caption" display="block">{stageInfo[stage]?.detail}</Typography></TableCell><TableCell><Chip size="small" label={portalStage === stage ? 'Enabled' : 'Inactive'} color={portalStage === stage ? 'success' : 'default'} /></TableCell><TableCell>{window.start ? formatDate(window.start) : 'Not set'} → {window.end ? formatDate(window.end) : 'Not set'}</TableCell><TableCell>{canOpen && <Button size="small" variant="contained" onClick={() => openModal('stage', { stage })}>Open phase</Button>}</TableCell></TableRow>; })}<TableRow><TableCell><strong>Completed results</strong><Typography variant="caption" display="block">Freeze the cycle as read-only.</Typography></TableCell><TableCell><Chip size="small" label={portalStage === 'completed' ? 'Enabled' : 'Inactive'} color={portalStage === 'completed' ? 'success' : 'default'} /></TableCell><TableCell>—</TableCell><TableCell><Button size="small" variant="contained" color="success" onClick={() => openModal('stage', { stage: 'completed' })}>Open phase</Button></TableCell></TableRow></TableBody></Table></Paper></>;
    if (role === 'admin' && view === 'Control levels') return <><Typography color="text.secondary" sx={{ mb: 2 }}>These switches are per CCA. Disabled controls are blocked by the server as well as hidden from the workflow.</Typography><Paper variant="outlined" sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow><TableCell>CCA</TableCell>{Object.entries(adminControlLabels).map(([key, label]) => <TableCell align="center" key={key}>{label}</TableCell>)}</TableRow></TableHead><TableBody>{ccas.map((cca) => <TableRow key={cca._id}><TableCell><strong>{cca.name}</strong></TableCell>{Object.keys(adminControlLabels).map((control) => { const enabled = data.ccaControls?.[cca._id]?.[control] !== false; return <TableCell align="center" key={control}><Switch checked={enabled} onChange={(event) => act('setCCAControl', { ccaId: cca._id, control, enabled: event.target.checked })} inputProps={{ 'aria-label': `${adminControlLabels[control]} for ${cca.name}` }} /></TableCell>; })}</TableRow>)}</TableBody></Table></Paper></>;
    if (role === 'admin' && view === 'Manage data') return <><Grid container spacing={2} sx={{ mb: 3 }}><Grid size={{ xs: 12, md: 4 }}><Card><CardContent><Typography variant="h6">Application exports</Typography><Typography color="text.secondary" sx={{ my: 1 }}>Download one ZIP per CCA with CSV data and attached CVs.</Typography><Button variant="contained" onClick={() => setView('CCA directory')}>Open CCA directory</Button></CardContent></Card></Grid><Grid size={{ xs: 12, md: 4 }}><Card><CardContent><Typography variant="h6">Access management</Typography><Typography color="text.secondary" sx={{ my: 1 }}>Assign CCA, Senate, and student workspace access.</Typography><Button variant="outlined" onClick={() => { setRole('senate'); setView('Policy & access'); }}>Open access controls</Button></CardContent></Card></Grid><Grid size={{ xs: 12, md: 4 }}><Card><CardContent><Typography variant="h6">Audit trail</Typography><Typography color="text.secondary" sx={{ my: 1 }}>Review lifecycle and control changes.</Typography><Button variant="outlined" onClick={() => setView('Audit trail')}>Open audit trail</Button></CardContent></Card></Grid></Grid><Paper variant="outlined"><Table><TableHead><TableRow><TableCell>CCA</TableCell><TableCell>Applications</TableCell><TableCell>Export</TableCell></TableRow></TableHead><TableBody>{ccas.map((cca) => <TableRow key={cca._id}><TableCell>{cca.name}</TableCell><TableCell>{applications.filter((application) => application.ccaId === cca._id).length}</TableCell><TableCell><Button size="small" variant="contained" disabled={!['selection', 'completed'].includes(portalStage) || !applications.some((application) => application.ccaId === cca._id)} onClick={() => downloadCCAExport(cca)}>Download ZIP</Button></TableCell></TableRow>)}</TableBody></Table></Paper></>;
    if (role === 'student' && !['selection', 'completed'].includes(portalStage)) return <Paper sx={{ p: { xs: 3, md: 6 }, textAlign: 'center' }}><Chip color={currentStage.color} label={currentStage.label} /><Typography variant="h4" sx={{ mt: 2 }}>{portalStage === 'applications' ? 'Apply and rank first' : 'The selection team is preparing your workspace'}</Typography><Typography color="text.secondary" sx={{ my: 2 }}>{portalStage === 'applications' ? 'The selection workspace will open after the application and ranking window closes.' : 'Applications are locked while CCAs and Senate finalize criteria, rounds, panels, and schedules.'}</Typography><Button variant="contained" onClick={() => navigate(portalStage === 'applications' ? '/apply' : '/home')}>{portalStage === 'applications' ? 'Go to applications' : 'Back home'}</Button></Paper>;
    if (view === 'Overview') return <><Card sx={{ mb: 3, borderLeft: '6px solid', borderColor: `${currentStage.color}.main` }}><CardContent><Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} spacing={2}><Box><Typography variant="overline">PORTAL LIFECYCLE</Typography><Typography variant="h4">{currentStage.label}</Typography><Typography color="text.secondary">{currentStage.detail}</Typography></Box><Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>{canControlPortal && portalStage === 'applications' && <Button variant="contained" color="warning" onClick={() => openModal('stage', { stage: 'configuration' })}>Close applications</Button>}{canControlPortal && portalStage === 'configuration' && <><Button variant="outlined" onClick={() => openModal('stage', { stage: 'applications' })}>Reopen applications</Button><Button variant="contained" onClick={() => openModal('stage', { stage: 'selection' })}>Open selection workspace</Button></>}{canControlPortal && portalStage === 'selection' && <><Button variant="outlined" color="warning" onClick={() => openModal('stage', { stage: 'configuration' })}>Return to internal setup</Button><Button variant="contained" color="success" onClick={() => openModal('stage', { stage: 'completed' })}>Complete cycle</Button></>}{canControlPortal && portalStage === 'completed' && <Button variant="outlined" onClick={() => openModal('stage', { stage: 'selection' })}>Reopen selection workspace</Button>}{role === 'senate' && !data?.isPortalAdmin && <Chip color="info" label="Lifecycle controlled by admin" />}</Stack></Stack></CardContent></Card><Grid container spacing={2}><Grid size={{ xs: 12, sm: 6, md: 3 }}><StatCard label="CCAs configured" value={data.allCCAs.length} detail="Directory records" /></Grid><Grid size={{ xs: 12, sm: 6, md: 3 }}><StatCard label="Applications" value={applications.length} detail={`${data.students.length} students`} /></Grid><Grid size={{ xs: 12, sm: 6, md: 3 }}><StatCard label="Active selections" value={ccas.filter((cca) => cca.selectionStatus === 'Locked').length} detail="Rounds in progress" /></Grid><Grid size={{ xs: 12, sm: 6, md: 3 }}><StatCard label="Needs attention" value={openExceptions.length} detail="Open exceptions" /></Grid></Grid><Typography variant="h5" sx={{ mt: 4, mb: 2 }}>Selection progress</Typography><Paper variant="outlined"><Table><TableHead><TableRow><TableCell>CCA</TableCell><TableCell>Status</TableCell><TableCell>Seats</TableCell><TableCell>Rounds</TableCell><TableCell>Applications</TableCell></TableRow></TableHead><TableBody>{ccas.map((cca) => <TableRow key={cca._id}><TableCell>{cca.name}</TableCell><TableCell><Chip size="small" label={cca.selectionStatus} color={statusColor(cca.selectionStatus)} /></TableCell><TableCell>{cca.seats}</TableCell><TableCell>{cca.rounds.length}</TableCell><TableCell>{applications.filter((application) => application.ccaId === cca._id).length}</TableCell></TableRow>)}</TableBody></Table></Paper></>;
    if (view === 'CCA directory' || view === 'Explore CCAs') return <Grid container spacing={2}>{ccas.map((cca) => <Grid size={{ xs: 12, sm: 6, lg: 4 }} key={cca._id}><Card sx={{ height: '100%', borderTop: `5px solid ${cca.brandColor}` }}><CardContent><Stack direction="row" justifyContent="space-between" alignItems="center"><Avatar src={cca.logo} sx={{ bgcolor: cca.brandColor }}>{cca.logoText}</Avatar><Chip size="small" label={cca.selectionStatus} color={statusColor(cca.selectionStatus)} /></Stack><Typography variant="h5" sx={{ mt: 2 }}>{cca.name}</Typography><Typography color="text.secondary" sx={{ my: 1 }}>{cca.description}</Typography><Typography variant="body2">{cca.seats || 0} seats · {cca.rounds.length} rounds</Typography><Divider sx={{ my: 2 }} /><Typography variant="subtitle2">Verticals</Typography><Typography variant="body2" color="text.secondary">{cca.verticals.length ? cca.verticals.map((vertical) => `${vertical.name} (${vertical.seats})`).join(' · ') : 'Pending setup'}</Typography><Typography variant="subtitle2" sx={{ mt: 1 }}>Selection rounds</Typography><Typography variant="body2" color="text.secondary">{cca.rounds.length ? cca.rounds.map((round) => `${isCVReview(round) ? 'Round 0 · CV review (no elimination)' : `${round.name} · ${round.type}`} · ${formatDate(round.deadline)}`).join(' / ') : 'Pending setup'}</Typography><Typography variant="caption" display="block" sx={{ mt: 1 }}>Application deadline: {formatDate(cca.applicationDeadline)}</Typography>{['senate', 'admin'].includes(role) && cca.selectionStatus === 'Awaiting ratification' && <Button fullWidth variant="contained" sx={{ mt: 2 }} onClick={() => act('ratifyResults', { ccaId: cca._id })}>Ratify & publish</Button>}</CardContent></Card></Grid>)}</Grid>;
    if (view === 'Live interviews' || view === 'My schedule') return <Stack spacing={2}>{panelRunCards}{sessionCards}</Stack>;
    if (view === 'Scores & results' && role === 'senate') return <><Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}><Box><Typography variant="h5">Locked evaluations</Typography><Typography color="text.secondary">Senate can inspect scores, correction history, and published outcomes.</Typography></Box><Button variant="contained" onClick={() => downloadBlob(`${API}/results-export?previewRole=senate`, 'calvin-selection-results.csv')}>Export outcomes CSV</Button></Stack><Paper variant="outlined" sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow><TableCell>Student</TableCell><TableCell>CCA / round</TableCell><TableCell>Original</TableCell><TableCell>Current</TableCell><TableCell>Locked at</TableCell><TableCell>Correction</TableCell></TableRow></TableHead><TableBody>{(data.evaluations || []).map((evaluation) => { const cca = ccas.find((item) => item._id === evaluation.ccaId); const correction = (data.markCorrections || []).filter((item) => item.evaluationId === evaluation.id).at(-1); return <TableRow key={evaluation.id}><TableCell>{data.students.find((student) => student.id === evaluation.userId)?.name || evaluation.userId}</TableCell><TableCell>{cca?.name} · {cca?.rounds.find((round) => round._id === evaluation.roundId)?.name}</TableCell><TableCell>{evaluation.total} / {evaluation.maxMarks}</TableCell><TableCell>{correction?.total ?? evaluation.total}</TableCell><TableCell>{formatDate(evaluation.createdAt)}</TableCell><TableCell><Button size="small" disabled={cca?.resultsPublished} onClick={() => openModal('correctMark', { evaluationId: evaluation.id, originalTotal: evaluation.total, maxMarks: evaluation.maxMarks, total: correction?.total ?? evaluation.total, reason: '', evidence: '' })}>Correct with reason</Button></TableCell></TableRow>; })}</TableBody></Table>{!(data.evaluations || []).length && <Box sx={{ p: 2 }}><Empty>No scores locked yet.</Empty></Box>}</Paper><Typography variant="h6" sx={{ mt: 3, mb: 1 }}>Correction history</Typography><Stack spacing={1}>{(data.markCorrections || []).map((item) => <Paper variant="outlined" sx={{ p: 2 }} key={item.id}>{item.previousTotal} → {item.total} · {item.reason}<Typography variant="caption" display="block">{item.authorizedBy} · {formatDate(item.createdAt)} · Evidence: {item.evidence}</Typography></Paper>)}</Stack></>;
    if (view === 'Exceptions & alerts') return <Stack spacing={2}>{(data.exceptions || []).map((item) => <Paper variant="outlined" sx={{ p: 2 }} key={item.id}><Stack direction="row" justifyContent="space-between"><Typography variant="h6">{allCCAs.find((cca) => cca._id === item.ccaId)?.name || 'CCA exception'}</Typography><Chip size="small" label={item.status} color={statusColor(item.status)} /></Stack><Typography sx={{ my: 1 }}>{item.reason}</Typography>{item.resolution && <Alert severity="success">{item.resolution}</Alert>}{item.status === 'Open' && <Stack direction="row" spacing={1}><Button variant="contained" onClick={() => openModal('resolve', { exceptionId: item.id, resolution: '' })}>Resolve</Button>{item.sessionId && <Button variant="outlined" color="warning" onClick={() => openModal('interviewOverride', { exceptionId: item.id, operation: 'markStudentComplete', userId: data.sessions.find((session) => session.id === item.sessionId)?.students?.[0] || '', reason: '', evidence: '' })}>Override interview</Button>}</Stack>}</Paper>)}{!(data.exceptions || []).length && <Empty>There are no exceptions.</Empty>}</Stack>;
    if (view === 'Audit trail') return <><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={2} sx={{ mb: 2 }}><Box><Typography variant="h5">Audit trail</Typography><Typography color="text.secondary">Lifecycle changes, evaluations, corrections, and rejected actions.</Typography></Box>{['senate', 'admin'].includes(role) && <Button variant="contained" onClick={() => downloadBlob(`${API}/audit-export?previewRole=${role}`, 'calvin-audit-trail.csv')}>Download audit CSV</Button>}</Stack><Paper variant="outlined" sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow><TableCell>Time</TableCell><TableCell>Actor</TableCell><TableCell>Action</TableCell><TableCell>Entity</TableCell></TableRow></TableHead><TableBody>{(data.audit || []).map((item) => <TableRow key={item.id}><TableCell>{formatDate(item.createdAt)}</TableCell><TableCell>{item.actor}<Typography variant="caption" display="block">{item.role}</Typography></TableCell><TableCell>{item.action}</TableCell><TableCell>{item.entity}</TableCell></TableRow>)}</TableBody></Table></Paper></>;
    if (view === 'Policy & access') return <Grid container spacing={3}><Grid size={{ xs: 12, md: 5 }}><Card><CardContent><Typography variant="h5">Candidate pool protection</Typography><Typography color="text.secondary" sx={{ my: 2 }}>Minimum retained applicants = seats × multiplier. Policy changes are versioned.</Typography><Typography variant="h2">{data.policy.multiplier ?? 'Off'}{data.policy.multiplier !== null && '×'}</Typography><Stack direction="row" alignItems="center" justifyContent="space-between"><Typography>Allow decimal marks</Typography><Switch checked={data.policy.decimals} disabled /></Stack><Button variant="contained" sx={{ mt: 2 }} onClick={() => openModal('policy', data.policy)}>Edit policy</Button></CardContent></Card></Grid><Grid size={{ xs: 12, md: 7 }}><Card><CardContent><Typography variant="h5">Workspace access</Typography><Typography color="text.secondary" sx={{ my: 2 }}>Registered Calvin accounts can be assigned Student, CCA, or Senate access.</Typography><Button variant="contained" onClick={() => openModal('member', { role: 'student' })}>Assign member access</Button><List>{data.students.map((student) => <ListItemButton key={student.id}><ListItemText primary={student.email} secondary={`${student.role}${student.rollNumber ? ` · ${student.rollNumber}` : ''}`} /></ListItemButton>)}</List></CardContent></Card></Grid></Grid>;
    if (view === 'My CCA' && currentCCA) return <><Grid container spacing={2}><Grid size={{ xs: 12, sm: 3 }}><StatCard label="Applications" value={applications.length} detail="Across verticals" /></Grid><Grid size={{ xs: 12, sm: 3 }}><StatCard label="Participating" value={applications.filter((item) => item.status === 'Participating').length} detail="Still active" /></Grid><Grid size={{ xs: 12, sm: 3 }}><StatCard label="Locked evaluations" value={(data.evaluations || []).length} detail="Scores stay private" /></Grid><Grid size={{ xs: 12, sm: 3 }}><StatCard label="Seats" value={currentCCA.seats} detail={`${currentCCA.verticals.length} verticals`} /></Grid></Grid><Paper sx={{ p: 3, mt: 3, bgcolor: '#f4edff' }}><Typography variant="overline">{isCVReview(currentRound) ? 'View applications & CVs' : 'Current selection stage'}</Typography><Typography variant="h3">{isCVReview(currentRound) ? 'Application review' : currentRound?.name || 'Configure your selection'}</Typography><Typography>{isCVReview(currentRound) ? 'Review all applications and CVs. Everyone remains eligible; no scores or eliminations happen at this stage.' : currentRound?.type || 'Set verticals, seats and rounds during internal setup.'}</Typography><Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}><Chip label={currentCCA.selectionStatus} color={statusColor(currentCCA.selectionStatus)} /><Button variant="contained" onClick={() => setView('View applications')}>View applications</Button><Button variant="outlined" onClick={() => setView('Selection structure')}>Open structure</Button>{currentCCA.selectionStatus === 'Draft' && <Button variant="outlined" disabled={!['applications', 'configuration'].includes(portalStage)} onClick={() => act('setCCAStatus', { ccaId: currentCCA._id, status: 'Finalized' })}>Finish round building</Button>}{currentCCA.selectionStatus === 'Finalized' && <Button variant="contained" disabled={portalStage !== 'selection' || !isCVReview(currentRound) || currentRound.status !== 'Active'} onClick={() => act('setCCAStatus', { ccaId: currentCCA._id, status: 'Locked' })}>Finish application review & open Round 1</Button>}</Stack></Paper></>;
    if (view === 'Selection structure' && currentCCA) return <Card><CardContent><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="h5">Selection structure</Typography><Typography color="text.secondary">Edit round formats, scoring rubrics, and timelines independently from seats and verticals.</Typography></Box><Stack direction="row" spacing={1}><Button variant="outlined" disabled={portalStage !== 'configuration' || currentCCA.selectionStatus !== 'Draft'} onClick={() => openModal('configure', configureInitial())}>Edit seats & verticals</Button><Button variant="contained" disabled={!['applications', 'configuration'].includes(portalStage) || currentCCA.resultsPublished || currentCCA.selectionStatus !== 'Draft'} onClick={() => openModal('round', roundFormFrom({}, currentCCA.rounds.filter((item) => !isCVReview(item)).length))}>Add round</Button></Stack></Stack>{currentCCA.selectionStatus !== 'Draft' && <Alert severity="info" sx={{ mt: 2 }}>After round building is complete, name, type, marks, weight, and rubric are fixed. Scheduled start, deadline, instructions, and documents can change until the round starts.</Alert>}<Divider sx={{ my: 2 }} /><Typography variant="body2">Constitutional strength: {currentCCA.constitutionalStrength || currentCCA.seats} · Available seats: {currentCCA.seats}</Typography><Typography variant="body2">Contact: {currentCCA.contactPerson || 'Not set'}</Typography><Typography variant="h6" sx={{ mt: 2 }}>Verticals</Typography>{currentCCA.verticals.map((vertical) => <Stack direction="row" justifyContent="space-between" sx={{ py: 1 }} key={vertical.name}><span>{vertical.name}</span><strong>{vertical.seats} seats</strong></Stack>)}<Typography variant="h6" sx={{ mt: 3 }}>Rounds</Typography>{currentCCA.rounds.map((round) => <Paper variant="outlined" sx={{ p: 2, my: 1 }} key={round._id}><Stack direction="row" justifyContent="space-between"><Box><strong>{isCVReview(round) ? 'Round 0' : `Round ${currentCCA.rounds.filter((item) => !isCVReview(item)).indexOf(round) + 1}`} · {round.name}</strong><Typography variant="body2">{isCVReview(round) ? 'CV review · everyone remains eligible · no marks or eliminations' : `${round.type} · ${round.maxMarks} marks · Weight ${round.weight} · Starts ${formatDate(round.startAt)}`}{!isCVReview(round) && ` · Deadline ${formatDate(round.deadline)}`}</Typography><LinkedText sx={{ fontSize: '0.8rem', mt: 0.5 }}>{round.criteria || 'Scoring rubric not set'}</LinkedText></Box><Stack alignItems="flex-end" spacing={1}><Chip label={round.publishedAt ? 'Published' : round.status} />{role === 'cca' && !isCVReview(round) && <Stack direction="row" spacing={1}><Button size="small" disabled={!['applications', 'configuration', 'selection'].includes(portalStage) || currentCCA.resultsPublished || !canEditRound(round)} onClick={() => openModal('round', roundFormFrom(round, currentCCA.rounds.filter((item) => !isCVReview(item)).indexOf(round)))}>Edit</Button><Button size="small" variant="outlined" disabled={portalStage !== 'selection' || Boolean(round.publishedAt)} onClick={() => act('publishRound', { ccaId: currentCCA._id, roundId: round._id })}>Publish</Button></Stack>}</Stack></Stack></Paper>)}</CardContent></Card>;
    if (view === 'View applications') return <><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={2} sx={{ mb: 2 }}><Box><Typography variant="h5">Applications & CVs</Typography><Typography color="text.secondary">{portalStage === 'selection' || portalStage === 'completed' ? 'Review each application and open or download its attached CV.' : 'CV access opens when the Selection workspace is opened.'}</Typography></Box><Button variant="contained" disabled={!['selection', 'completed'].includes(portalStage) || !applications.length} onClick={downloadApplicantExport}>Download applications + CVs (.zip)</Button></Stack>{portalStage === 'configuration' && <Alert severity="info" sx={{ mb: 2 }}>Applications are frozen for internal setup. Applicant records are visible, but CVs and exports will unlock when the admin opens the Selection workspace.</Alert>}{role === 'cca' && isCVReview(currentRound) && portalStage === 'selection' && <Alert severity="info" sx={{ mb: 2 }}>Application review is open. Everyone remains eligible; CVs are available below, with no marks or eliminations at this stage.</Alert>}{applicationRows()}</>;
    if (view === 'Panels & interviews' && currentCCA) return <>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 280 } }} disabled={!interviewRounds.length}>
          <InputLabel id="panel-round-label">Interview round</InputLabel>
          <Select labelId="panel-round-label" label="Interview round" value={panelRound?._id || ''} onChange={(event) => setPanelRoundId(event.target.value)}>
            {interviewRounds.map((round) => <MenuItem value={round._id} key={round._id}>{round.name} · {round.type}</MenuItem>)}
          </Select>
        </FormControl>
        <Button variant="contained" disabled={portalStage === 'completed' || !panelRound} onClick={() => openModal('panel', { ccaId: currentCCA._id, roundId: panelRound._id, name: '', members: [] })}>Create panel</Button>
      </Stack>
      {!interviewRounds.length
        ? <Alert severity="warning" sx={{ mb: 2 }}>There are no interview rounds to attach a panel to yet. Add a round with one of these types in Selection structure: Individual · Interview, Individual · Task + Interview, Group · Interview, or Group · Task + Interview.</Alert>
        : <Alert severity="info" sx={{ mb: 2 }} action={isCVReview(currentRound) ? <Button color="inherit" size="small" onClick={() => setView('My CCA')}>Open My CCA</Button> : undefined}>
          {isCVReview(currentRound)
            ? 'Round 0 is currently active. Use My CCA to finish application review and open Round 1. Later rounds become active after the preceding round is completed. You can prepare panels in advance, but only the active round can be started.'
            : 'You can create, edit, or delete panels until they start. Only the active round can be started, and its scheduled start time must have arrived.'} Only Individual/Group Interview and Task + Interview rounds can have panels.
        </Alert>}
      {panelRound && <>
        <Typography variant="h6" sx={{ mb: 1 }}>Panels for {panelRound.name}</Typography>
        <Stack spacing={1} sx={{ mb: 3 }}>
          {roundPanels.map((panel) => {
            const canStart = portalStage === 'selection'
              && String(currentRound?._id) === String(panelRound._id)
              && panelRound.status === 'Active'
              && panelRound.startAt
              && Date.now() >= new Date(panelRound.startAt).getTime()
              && panel.members.includes(data.currentUser.email)
              && !(data.panelRuns || []).some((run) => run.panelId === panel.id && run.status === 'Active');
            const startBlockReason = portalStage !== 'selection'
              ? 'Open the Selection workspace before starting panels.'
              : String(currentRound?._id) !== String(panelRound._id)
                ? isCVReview(currentRound)
                  ? 'Finish application review and open Round 1 from My CCA. Later rounds open after the previous round is completed.'
                  : `Complete ${currentRound?.name || 'the active round'} before starting ${panelRound.name}.`
                : panelRound.status !== 'Active'
                  ? `${panelRound.name} is not active yet.`
                  : !panelRound.startAt
                    ? 'Set a scheduled start time for this round.'
                    : Date.now() < new Date(panelRound.startAt).getTime()
                      ? `This panel opens at ${formatDate(panelRound.startAt)}.`
                      : !panel.members.includes(data.currentUser.email)
                        ? 'Only a member listed on this panel can start it.'
                        : (data.panelRuns || []).some((run) => run.panelId === panel.id && run.status === 'Active')
                          ? 'This panel already has an active session.'
                          : '';
            return <Paper variant="outlined" sx={{ p: 2 }} key={panel.id}>
              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
                <Box><strong>{panel.name}</strong><Typography variant="body2">{panelRound.name} · {panel.members.join(', ')}</Typography><Typography variant="caption" display="block">{panel.locked ? 'Started · panel details locked' : 'Not started · editable'} · Scheduled start: {formatDate(panelRound.startAt)}</Typography>{!canStart && <Typography variant="caption" color="warning.main" display="block">{startBlockReason}</Typography>}</Box>
                <Button variant="contained" disabled={!canStart} onClick={() => openModal('panelStart', { ccaId: currentCCA._id, roundId: panelRound._id, panelId: panel.id, lateMinutes: 0 })}>Start panel</Button>
              </Stack>
            </Paper>;
          })}
          {!roundPanels.length && <Empty>No base panels are set for {panelRound.name}.</Empty>}
        </Stack>
      </>}
      <Typography variant="h6" sx={{ mb: 1 }}>Live panels</Typography>{panelRunCards}
      <Typography variant="h6" sx={{ mb: 1 }}>All panels</Typography>
      <Stack spacing={1} sx={{ mb: 3 }}>
        {(data.panels || []).filter((panel) => panel.ccaId === String(currentCCA._id)).map((panel) => <Paper variant="outlined" sx={{ p: 2 }} key={panel.id}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Box><strong>{panel.name}</strong> · {currentCCA.rounds.find((round) => round._id === panel.roundId)?.name || 'Round'}<Typography variant="body2" color="text.secondary">{panel.members.join(', ')}</Typography><Typography variant="caption">{panel.locked ? 'Started · panel details locked' : 'Not started · editable'}</Typography></Box>
            {!panel.locked && !(data.panelRuns || []).some((run) => run.panelId === panel.id) && <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => openModal('panel', { ccaId: currentCCA._id, panelId: panel.id, roundId: panel.roundId, name: panel.name, members: panel.members || [] })}>Edit</Button>
              <Button size="small" color="error" onClick={() => openModal('deletePanel', { ccaId: currentCCA._id, panelId: panel.id, name: panel.name })}>Delete</Button>
            </Stack>}
          </Stack>
        </Paper>)}
        {!(data.panels || []).some((panel) => panel.ccaId === String(currentCCA._id)) && <Empty>No panels have been created yet.</Empty>}
      </Stack>
      <Typography variant="h6" sx={{ mb: 1 }}>Groups</Typography><Stack spacing={1} sx={{ mb: 3 }}>{(data.groups || []).map((group) => <Paper variant="outlined" sx={{ p: 2 }} key={group.id}>{group.name} · {group.students.map((student) => data.students.find((item) => item.id === student)?.name || student).join(', ')}</Paper>)}</Stack>{sessionCards}
    </>;
    if (view === 'Evaluations' && currentCCA) return <>
      {isCVReview(currentRound) ? <Alert severity="info" sx={{ mb: 2 }}>This is the application-review stage. Everyone remains eligible; no scores or eliminations are allowed. Review CVs under View applications, then use My CCA to open Round 1.</Alert> : <>
        <Alert severity="info" sx={{ mb: 2 }}>Scores disappear from the CCA view after submission. Round evaluations are locked once submitted.</Alert>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {currentRound?.type.startsWith('Screening') ? <Button variant="contained" disabled={portalStage !== 'selection' || currentRound.status !== 'Active' || currentRound.type.includes('Interview')} onClick={() => openModal('screen', { ccaId: currentCCA._id, roundId: currentRound._id, decisions: [] })}>Record screening decisions</Button> : <Button variant="contained" disabled={portalStage !== 'selection' || currentRound?.status !== 'Active' || currentRound?.type.includes('Interview')} onClick={() => openModal('evaluate', { ccaId: currentCCA._id, roundId: currentRound._id, panelId: null, entries: [] })}>Enter task evaluations</Button>}
          <Button variant="outlined" disabled={portalStage !== 'selection' || currentRound?.status !== 'Active'} onClick={() => openModal('roundFinish', { ccaId: currentCCA._id, roundId: currentRound._id, eliminate: currentRound.eliminate || 0 })}>Complete round</Button>
        </Stack>
      </>}
      <Typography variant="h5" sx={{ mt: 3, mb: 1 }}>Task submissions</Typography><Paper variant="outlined"><List>{(data.submissions || []).filter((submission) => !currentRound || submission.roundId === currentRound._id).map((submission) => <ListItemButton key={submission.id} onClick={() => openSubmission(submission)}><ListItemText primary={submission.name} secondary={`${data.students.find((student) => student.id === submission.userId)?.name || 'Student'} · ${formatDate(submission.submittedAt)}${submission.late ? ' · Late' : ''}`} /></ListItemButton>)}</List>{!(data.submissions || []).length && <Box sx={{ p: 2 }}><Empty>No submissions recorded.</Empty></Box>}</Paper><Box sx={{ mt: 2 }}>{applicationRows()}</Box>
    </>;
    if (view === 'Results') return <><Alert severity={currentCCA?.resultsPublished ? 'success' : 'info'} sx={{ mb: 2 }}>{currentCCA?.resultsPublished ? 'Final results have been ratified and published.' : 'Results become final after every round is completed and Senate ratifies the outcome.'}</Alert>{applicationRows()}</>;
    if (view === 'My applications') return <Stack spacing={2}>{panelRunCards}{applications.map((application) => {
      const cca = ccas.find((item) => item._id === application.ccaId);
      const round = cca?.rounds?.[cca.currentRound || 0];
      const upcomingRound = isCVReview(round) ? cca?.rounds?.find((item) => !isCVReview(item) && item.status !== 'Completed') : null;
      const submission = data.submissions.find((item) => item.roundId === round?._id && item.students?.includes(data.currentUser.id));
      const verticalLocked = cca?.rounds?.some((item) => !isCVReview(item) && (item.startedAt || ['Active', 'Completed'].includes(item.status)));
      return <Card key={application.id}><CardContent><Stack direction="row" justifyContent="space-between" spacing={2}><Box><Typography variant="h5">{cca?.name}</Typography><Typography color="text.secondary">Preference #{application.preference || '—'} · Applied {formatDate(application.createdAt)}</Typography></Box><Chip label={application.status} color={statusColor(application.status)} /></Stack><Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }} alignItems="center"><Typography variant="body2">Preferred vertical</Typography><FormControl size="small" sx={{ minWidth: 190 }}><Select value={cca?.verticals.some((item) => item.name === application.vertical) ? application.vertical : ''} displayEmpty disabled={verticalLocked || !['Applied', 'Participating'].includes(application.status)} onChange={(event) => chooseVertical(application, event.target.value)}><MenuItem value="" disabled>Choose a vertical</MenuItem>{(cca?.verticals || []).map((vertical) => <MenuItem key={vertical.name} value={vertical.name}>{vertical.name} · {vertical.seats} seats</MenuItem>)}</Select></FormControl></Stack><Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>{cca?.rounds?.map((item) => `${item.name}: ${item.status}${!isCVReview(item) ? ` · weight ${item.weight}` : ''}`).join(' · ') || 'Selection structure pending'}</Typography>{round && ['Applied', 'Participating'].includes(application.status) && <><Paper variant="outlined" sx={{ p: 2, mt: 2 }}><Typography variant="overline">{isCVReview(round) ? 'Round 0 · CV review · non-eliminative' : `Current round · ${round.type}`}</Typography><Typography variant="h6">{round.name}</Typography>{!isCVReview(round) && <Typography variant="body2" color="text.secondary">Maximum marks: {round.maxMarks} · Weight: {round.weight}</Typography>}<LinkedText>{round.instructions || 'Instructions will appear when the round opens.'}</LinkedText>{!isCVReview(round) && round.criteria && <><Typography variant="body2" sx={{ mt: 1 }}><strong>Scoring rubric</strong></Typography><LinkedText>{round.criteria}</LinkedText></>}{(round.documents || []).map((document) => <Button key={document.fileKey} size="small" sx={{ mt: 1, mr: 1 }} onClick={() => openRoundDocument(document)}>{document.name}</Button>)}{!isCVReview(round) && <Typography variant="caption" display="block">Due {formatDate(round.deadline)}</Typography>}{round.status === 'Active' && round.type.includes('Task') && !submission && <Button variant="contained" sx={{ mt: 2 }} onClick={() => openModal('submit', { ccaId: cca._id, roundId: round._id, name: '', url: '' })}>Submit task</Button>}{submission && <Chip sx={{ mt: 2 }} color={submission.late ? 'warning' : 'success'} label={`${submission.status || 'Submitted'} · ${formatDate(submission.submittedAt)}`} />}</Paper>{upcomingRound && <Paper variant="outlined" sx={{ p: 2, mt: 2, borderStyle: 'dashed' }}><Typography variant="overline">Round {cca.rounds.filter((item) => !isCVReview(item)).indexOf(upcomingRound) + 1} · Upcoming · {upcomingRound.type}</Typography><Typography variant="h6">{upcomingRound.name}</Typography><LinkedText>{upcomingRound.instructions || 'Instructions will appear here.'}</LinkedText><Typography variant="body2" sx={{ mt: 1 }}><strong>Scoring rubric</strong></Typography><LinkedText>{upcomingRound.criteria || 'Rubric will be shared when this round opens.'}</LinkedText>{(upcomingRound.documents || []).map((document) => <Button key={document.fileKey} size="small" sx={{ mt: 1, mr: 1 }} onClick={() => openRoundDocument(document)}>{document.name}</Button>)}<Typography variant="caption" display="block" sx={{ mt: 1 }}>Due {formatDate(upcomingRound.deadline)} · This round is not open yet.</Typography></Paper>}</>}</CardContent></Card>;
    })}{!applications.length && <Empty>You have no applications yet. Use the Apply page to choose and rank CCAs.</Empty>}</Stack>;
    return null;
  };
  const content = renderContent();

  if (loading && !data) return <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}><CircularProgress /></Box>;

  return (
    <Box sx={{ display: 'flex', minHeight: 'calc(100vh - 64px)', bgcolor: '#f8f6fb' }}>
      <Drawer variant="permanent" sx={{ width: drawerWidth, flexShrink: 0, '& .MuiDrawer-paper': { width: drawerWidth, position: 'relative', boxSizing: 'border-box', bgcolor: '#221d28', color: 'white' } }}>
        <Toolbar><Typography variant="h5" sx={{ fontFamily: 'Bangers', letterSpacing: 1 }}>CALVIN 2.0</Typography></Toolbar><Divider sx={{ borderColor: 'rgba(255,255,255,.12)' }} />
        <Box sx={{ p: 2 }}><Typography variant="overline" color="grey.400">{data?.previewRolesEnabled ? 'Local preview workspace' : `${role.toUpperCase()} workspace`}</Typography>{data?.previewRolesEnabled && <FormControl fullWidth size="small" sx={{ mt: 1, '& .MuiInputBase-root': { bgcolor: 'white' } }}><Select value={role} onChange={(event) => setRole(event.target.value)}>{['student', 'cca', 'senate', 'admin'].map((item) => <MenuItem key={item} value={item}>{item === 'admin' ? 'Admin' : item[0].toUpperCase() + item.slice(1)}</MenuItem>)}</Select></FormControl>}{data?.isPortalAdmin && !data?.previewRolesEnabled && <FormControl fullWidth size="small" sx={{ mt: 1, '& .MuiInputBase-root': { bgcolor: 'white' } }}><Select value={role} onChange={(event) => setRole(event.target.value)}><MenuItem value="admin">Admin</MenuItem><MenuItem value="senate">Senate</MenuItem></Select></FormControl>}{role === 'cca' && data?.previewRolesEnabled && <FormControl fullWidth size="small" sx={{ mt: 1, '& .MuiInputBase-root': { bgcolor: 'white' } }}><Select value={ccaId || data?.ccaId || ''} onChange={(event) => setCcaId(event.target.value)}>{allCCAs.map((cca) => <MenuItem key={cca._id} value={cca._id}>{cca.name}</MenuItem>)}</Select></FormControl>}{role === 'cca' && !data?.previewRolesEnabled && <Typography variant="body2" sx={{ mt: 1 }}>{currentCCA?.name || 'CCA assignment pending'}</Typography>}</Box>
        <List>{roleViews[role].map((item) => { const Icon = viewIcons[item]; return <ListItemButton key={item} selected={view === item} onClick={() => setView(item)} sx={{ '&.Mui-selected': { bgcolor: 'primary.main' } }}><ListItemIcon sx={{ color: 'inherit', minWidth: 38 }}><Icon /></ListItemIcon><ListItemText primary={item} />{item === 'Exceptions & alerts' && openExceptions.length > 0 && <Chip size="small" color="error" label={openExceptions.length} />}</ListItemButton>; })}</List>
        <Box sx={{ mt: 'auto', p: 2 }}><Typography variant="caption" color="grey.400">Fairness by design<br />Locked evaluations · auditable decisions</Typography></Box>
      </Drawer>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <AppBar position="sticky" color="inherit" elevation={1}><Toolbar><IconButton onClick={() => navigate('/home')}><ArrowBackIcon /></IconButton><Typography sx={{ flexGrow: 1, ml: 1 }}>{data?.cycle || '2026–27'} selections</Typography><Tooltip title="Refresh"><IconButton onClick={load}><RefreshIcon /></IconButton></Tooltip><Tooltip title="Notifications"><IconButton onClick={() => openModal('notifications')}><Badge badgeContent={unread} color="error"><NotificationsIcon /></Badge></IconButton></Tooltip></Toolbar></AppBar>
        <Container maxWidth="xl" sx={{ py: 4 }}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ mb: 2 }}><Box><Typography variant="overline" color="primary">{role.toUpperCase()} WORKSPACE</Typography><Typography variant="h3">{view}</Typography></Box><Stack direction="row" spacing={1}><Chip color={currentStage.color} label={currentStage.label} /><Chip label={`Policy v${data?.policy?.version || 1}`} /></Stack></Stack><Alert severity={portalStage === 'configuration' ? 'warning' : portalStage === 'selection' ? 'info' : portalStage === 'completed' ? 'success' : 'info'} sx={{ mb: 3 }}><strong>{currentStage.label}.</strong> {currentStage.detail}</Alert>{error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}{content}</Container>
      </Box>

      <Dialog open={Boolean(modal)} onClose={() => setModal(null)} fullWidth maxWidth={modal === 'configure' || modal === 'round' || modal === 'schedulePortal' || modal === 'panelScore' ? 'md' : 'sm'}><DialogTitle>{({ stage: 'Change portal stage', schedulePortal: 'Set phase timings', policy: 'Edit selection policy', member: 'Assign workspace access', configure: 'Configure selection structure', round: form?._id ? 'Edit round' : 'Add round', panel: form.panelId ? 'Edit panel' : 'Create panel', deletePanel: 'Delete panel', panelStart: 'Start panel', panelMarkIn: 'Mark student in', panelScore: form.isEditing ? 'Edit marks' : 'Enter marks', assignPanel: 'Assign students', group: 'Assign group', schedule: 'Schedule interview', evaluate: 'Lock evaluations', screen: 'Record screening decisions', roundFinish: 'Complete round', correctMark: 'Authorized mark correction', exception: 'Raise exception', resolve: 'Resolve exception', interviewOverride: 'Senate interview override', submit: 'Submit task', notifications: 'Notifications' })[modal] || 'Selection workspace'}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
        {modal === 'stage' && <><Alert severity="warning">This immediately changes what students and CCAs can do across Calvin.</Alert><Typography>Move the portal from <strong>{currentStage.label}</strong> to <strong>{stageInfo[form.stage]?.label}</strong>?</Typography><Typography variant="body2" color="text.secondary">{stageInfo[form.stage]?.detail}</Typography></>}
        {modal === 'schedulePortal' && <><Alert severity="info">These windows are administrative reference points. The administrator still explicitly triggers each stage.</Alert>{['applications', 'configuration', 'selection'].map((stage) => <Paper variant="outlined" sx={{ p: 2 }} key={stage}><Typography variant="h6" sx={{ mb: 1 }}>{stageInfo[stage].label}</Typography><Grid container spacing={2}><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Start" type="datetime-local" InputLabelProps={{ shrink: true }} value={form.schedule?.[stage]?.start || ''} onChange={(event) => setForm({ ...form, schedule: { ...form.schedule, [stage]: { ...form.schedule[stage], start: event.target.value } } })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="End" type="datetime-local" InputLabelProps={{ shrink: true }} value={form.schedule?.[stage]?.end || ''} onChange={(event) => setForm({ ...form, schedule: { ...form.schedule, [stage]: { ...form.schedule[stage], end: event.target.value } } })} /></Grid></Grid></Paper>)}</>}
        {modal === 'policy' && <><TextField label="Candidate pool multiplier" type="number" value={form.multiplier ?? ''} onChange={(event) => setForm({ ...form, multiplier: event.target.value === '' ? null : Number(event.target.value) })} /><Stack direction="row" justifyContent="space-between" alignItems="center"><Typography>Allow decimal marks</Typography><Switch checked={Boolean(form.decimals)} onChange={(event) => setForm({ ...form, decimals: event.target.checked })} /></Stack><FormControl><InputLabel>Tie-break rule</InputLabel><Select label="Tie-break rule" value={form.tieBreaker || 'finalRound'} disabled={portalStage === 'selection' || portalStage === 'completed'} onChange={(event) => setForm({ ...form, tieBreaker: event.target.value })}><MenuItem value="finalRound">Higher final-round score</MenuItem><MenuItem value="earliestApplication">Earlier application</MenuItem></Select></FormControl></>}
        {modal === 'member' && <><TextField label="Registered email" value={form.email || ''} onChange={(event) => setForm({ ...form, email: event.target.value })} /><TextField label="Full name" value={form.fullName || ''} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /><FormControl><InputLabel>Role</InputLabel><Select label="Role" value={form.role || 'student'} onChange={(event) => setForm({ ...form, role: event.target.value })}>{['student', 'cca', 'senate'].map((item) => <MenuItem value={item} key={item}>{item}</MenuItem>)}</Select></FormControl>{form.role === 'cca' && <FormControl><InputLabel>CCA</InputLabel><Select label="CCA" value={form.ccaId || ''} onChange={(event) => setForm({ ...form, ccaId: event.target.value })}>{allCCAs.map((cca) => <MenuItem value={cca._id} key={cca._id}>{cca.name}</MenuItem>)}</Select></FormControl>}<TextField label="Roll number" value={form.rollNumber || ''} onChange={(event) => setForm({ ...form, rollNumber: event.target.value })} /></>}
        {modal === 'deletePanel' && <Alert severity="warning">Delete the unstarted panel {form.name}? This cannot be undone.</Alert>}
        {modal === 'panelStart' && <><Typography>{currentRound?.name}: {formatDate(currentRound?.startAt)}</Typography><TextField label="How many minutes is the panel running late?" type="number" inputProps={{ min: 0, max: 240 }} value={form.lateMinutes ?? 0} onChange={(event) => setForm({ ...form, lateMinutes: Number(event.target.value) })} /><Alert severity="info">Starting the panel notifies active applicants that their round has begun.</Alert></>}
        {modal === 'panelMarkIn' && <><Typography>Choose an active applicant to mark in for this panel.</Typography><FormControl><InputLabel>Student</InputLabel><Select label="Student" value={form.userId || ''} onChange={(event) => setForm({ ...form, userId: event.target.value })}>{panelCandidates(data.panelRuns.find((run) => run.id === form.panelRunId)).map((application) => <MenuItem key={application.userId} value={application.userId}>{application.studentName} · {application.rollNumber || application.email}</MenuItem>)}</Select></FormControl></>}
        {modal === 'panelScore' && (() => { const scoreRound = currentCCA?.rounds.find((item) => item._id === form.roundId); const combined = scoreRound?.type.includes('Task + Interview') && scoreRound.taskMaxMarks > 0 && scoreRound.interviewMaxMarks > 0; return <><Alert severity={form.isEditing ? 'warning' : 'info'}>{form.isEditing ? 'Edit window: 2 minutes from the original entry. The CCA cannot see saved marks.' : `Enter this score within 10 minutes, by ${formatDate(form.scoreDueAt)}. The CCA cannot view it again after submission.`}</Alert>{combined && <Stack direction="row" spacing={1}><TextField fullWidth label={`Task / ${scoreRound.taskMaxMarks}`} type="number" value={form.taskScore ?? ''} onChange={(event) => setForm({ ...form, taskScore: event.target.value, total: event.target.value !== '' && form.interviewScore !== '' ? Number(event.target.value) + Number(form.interviewScore) : '' })} /><TextField fullWidth label={`Interview / ${scoreRound.interviewMaxMarks}`} type="number" value={form.interviewScore ?? ''} onChange={(event) => setForm({ ...form, interviewScore: event.target.value, total: event.target.value !== '' && form.taskScore !== '' ? Number(event.target.value) + Number(form.taskScore) : '' })} /></Stack>}<TextField label={`${form.studentName} · total / ${scoreRound?.maxMarks || ''}`} type="number" value={form.total ?? ''} onChange={(event) => setForm({ ...form, total: event.target.value })} />{scoreRound?.criteria && <Alert severity="info"><Typography fontWeight={700}>Scoring rubric</Typography><Typography sx={{ whiteSpace: 'pre-line' }}>{scoreRound.criteria}</Typography></Alert>}</>; })()}
        {modal === 'configure' && <>{ccaCoreLocked && <Alert severity="info">Seats and verticals are finalized and read-only. You can revise round details until the Selection workspace opens.</Alert>}<TextField label="CCA description" multiline minRows={2} value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} /><TextField label="Constitutional strength (candidate pool rule)" type="number" disabled={ccaCoreLocked} value={form.constitutionalStrength ?? ''} onChange={(event) => setForm({ ...form, constitutionalStrength: event.target.value })} /><TextField label="Contact person" value={form.contactPerson || ''} onChange={(event) => setForm({ ...form, contactPerson: event.target.value })} /><TextField label="Selection coordinators, one per line" multiline minRows={2} value={form.selectionCoordinators || ''} onChange={(event) => setForm({ ...form, selectionCoordinators: event.target.value })} /></>}
        {modal === 'configure' && <><Grid container spacing={2}><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Total seats" type="number" disabled={ccaCoreLocked} value={form.seats || ''} onChange={(event) => setForm({ ...form, seats: Number(event.target.value) })} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField fullWidth label="Application deadline" type="datetime-local" InputLabelProps={{ shrink: true }} value={form.applicationDeadline || ''} onChange={(event) => setForm({ ...form, applicationDeadline: event.target.value })} /></Grid></Grid><Typography variant="h6">Verticals</Typography>{form.verticals?.map((vertical, index) => <Stack direction="row" spacing={1} key={index}><TextField fullWidth label="Vertical name" disabled={ccaCoreLocked} value={vertical.name} onChange={(event) => setForm({ ...form, verticals: form.verticals.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /><TextField label="Seats" type="number" disabled={ccaCoreLocked} sx={{ width: 120 }} value={vertical.seats} onChange={(event) => setForm({ ...form, verticals: form.verticals.map((item, itemIndex) => itemIndex === index ? { ...item, seats: Number(event.target.value) } : item) })} />{!ccaCoreLocked && <Button color="error" onClick={() => setForm({ ...form, verticals: form.verticals.filter((_, itemIndex) => itemIndex !== index) })}>Remove</Button>}</Stack>)}{!ccaCoreLocked && <Button variant="outlined" onClick={() => setForm({ ...form, verticals: [...form.verticals, { name: '', seats: 1 }] })}>Add vertical</Button>}</>}
        {modal === 'round' && <RoundEditor round={form} onChange={setForm} structureBuilt={currentCCA?.selectionStatus !== 'Draft'} onUpload={uploadRoundDocument} uploadBusy={uploadBusy} />}
        {modal === 'panel' && <><FormControl disabled={Boolean(form.panelId)}><InputLabel>Interview round</InputLabel><Select label="Interview round" value={form.roundId || ''} onChange={(event) => setForm({ ...form, roundId: event.target.value })}>{(currentCCA?.rounds || []).filter((round) => !isCVReview(round) && isInterview(round)).map((round) => <MenuItem value={round._id} key={round._id}>{round.name}</MenuItem>)}</Select></FormControl><TextField label="Panel name" value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} /><FormControl><InputLabel>Panel members · PGP email</InputLabel><Select multiple label="Panel members · PGP email" value={form.members || []} onChange={(event) => setForm({ ...form, members: event.target.value })}>{panelMembers.map((member) => <MenuItem value={member.email} key={member.email}>{member.email}</MenuItem>)}</Select><FormHelperText>Only these members can start the panel, record attendance, and enter marks.</FormHelperText></FormControl></>}
        {modal === 'assignPanel' && <FormControl><InputLabel>Applicants</InputLabel><Select multiple label="Applicants" value={form.students || []} onChange={(event) => setForm({ ...form, students: event.target.value })}>{applications.filter((application) => ['Applied', 'Participating'].includes(application.status)).map((application) => <MenuItem key={application.userId} value={application.userId}>{application.studentName}</MenuItem>)}</Select></FormControl>}
        {modal === 'schedule' && <><FormControl><InputLabel>Panel</InputLabel><Select label="Panel" value={form.panelId || ''} onChange={(event) => setForm({ ...form, panelId: event.target.value })}>{(data?.panels || []).filter((panel) => panel.roundId === form.roundId).map((panel) => <MenuItem value={panel.id} key={panel.id}>{panel.name}</MenuItem>)}</Select></FormControl><FormControl><InputLabel>Students</InputLabel><Select multiple label="Students" value={form.students || []} onChange={(event) => setForm({ ...form, students: event.target.value })}>{applications.filter((application) => ['Applied', 'Participating'].includes(application.status)).map((application) => <MenuItem value={application.userId} key={application.userId}>{application.studentName}</MenuItem>)}</Select></FormControl><TextField label="Date and time" type="datetime-local" InputLabelProps={{ shrink: true }} value={form.time || ''} onChange={(event) => setForm({ ...form, time: event.target.value })} /><TextField label="Location or meeting link" value={form.location || ''} onChange={(event) => setForm({ ...form, location: event.target.value })} /></>}
        {modal === 'group' && <><TextField label="Group name" value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} /><FormControl><InputLabel>Panel</InputLabel><Select label="Panel" value={form.panelId || ''} onChange={(event) => setForm({ ...form, panelId: event.target.value, students: [] })}>{(data?.panels || []).filter((panel) => panel.roundId === form.roundId).map((panel) => <MenuItem value={panel.id} key={panel.id}>{panel.name}</MenuItem>)}</Select></FormControl><FormControl><InputLabel>Students</InputLabel><Select multiple label="Students" value={form.students || []} onChange={(event) => setForm({ ...form, students: event.target.value })}>{applications.filter((application) => ['Applied', 'Participating'].includes(application.status) && data.panels.find((panel) => panel.id === form.panelId)?.students?.includes(application.userId)).map((application) => <MenuItem value={application.userId} key={application.userId}>{application.studentName}</MenuItem>)}</Select></FormControl></>}
        {modal === 'evaluate' && <>{currentRound?.criteria && <Alert severity="info"><Typography fontWeight={700}>Scoring rubric · {currentRound.name}</Typography><Typography sx={{ whiteSpace: 'pre-line' }}>{currentRound.criteria}</Typography></Alert>}{form.entries?.length === 0 && <FormControl><InputLabel>Students</InputLabel><Select multiple label="Students" value={[]} onChange={(event) => setForm({ ...form, entries: event.target.value.map((userId) => ({ userId, total: '', taskScore: '', interviewScore: '' })) })}>{applications.filter((application) => ['Applied', 'Participating'].includes(application.status) && !(data.evaluations || []).some((evaluation) => evaluation.roundId === form.roundId && evaluation.userId === application.userId)).map((application) => <MenuItem value={application.userId} key={application.userId}>{application.studentName}</MenuItem>)}</Select></FormControl>}{form.entries?.map((entry, index) => currentRound?.type.includes('Task + Interview') && currentRound.taskMaxMarks > 0 && currentRound.interviewMaxMarks > 0 ? <Stack direction="row" spacing={1} key={entry.userId}><TextField fullWidth label={`${data?.students.find((student) => student.id === entry.userId)?.name || entry.userId} task / ${currentRound.taskMaxMarks}`} type="number" value={entry.taskScore ?? ''} onChange={(event) => updateScore(index, 'taskScore', event.target.value)} /><TextField fullWidth label={`Interview / ${currentRound.interviewMaxMarks}`} type="number" value={entry.interviewScore ?? ''} onChange={(event) => updateScore(index, 'interviewScore', event.target.value)} /></Stack> : <TextField key={entry.userId} label={`${data?.students.find((student) => student.id === entry.userId)?.name || entry.userId} score / ${currentRound?.maxMarks || ''}`} type="number" value={entry.total} onChange={(event) => updateScore(index, 'total', event.target.value)} />)}<Alert severity="warning">Review carefully. Once submitted, these marks are locked and hidden from the CCA.</Alert></>}
        {modal === 'screen' && <><Typography>Round 0 records only promoted or eliminated. No marks are stored.</Typography><FormControl><InputLabel>Assigned panel</InputLabel><Select label="Assigned panel" value={form.panelId || ''} onChange={(event) => setForm({ ...form, panelId: event.target.value, decisions: [] })}>{(data?.panels || []).filter((panel) => panel.roundId === form.roundId).map((panel) => <MenuItem key={panel.id} value={panel.id}>{panel.name}</MenuItem>)}</Select></FormControl>{form.decisions?.length === 0 && <FormControl><InputLabel>Students</InputLabel><Select multiple label="Students" value={[]} onChange={(event) => setForm({ ...form, decisions: event.target.value.map((userId) => ({ userId, decision: 'Promoted' })) })}>{applications.filter((application) => ['Applied', 'Participating'].includes(application.status) && data.panels.find((panel) => panel.id === form.panelId)?.students?.includes(application.userId) && !(data.screeningDecisions || []).some((decision) => decision.roundId === form.roundId && decision.userId === application.userId)).map((application) => <MenuItem value={application.userId} key={application.userId}>{application.studentName}</MenuItem>)}</Select></FormControl>}{form.decisions?.map((decision, index) => <FormControl key={decision.userId}><InputLabel>{data?.students.find((student) => student.id === decision.userId)?.name || decision.userId}</InputLabel><Select label={data?.students.find((student) => student.id === decision.userId)?.name || decision.userId} value={decision.decision} onChange={(event) => setForm({ ...form, decisions: form.decisions.map((item, itemIndex) => itemIndex === index ? { ...item, decision: event.target.value } : item) })}><MenuItem value="Promoted">Promoted</MenuItem><MenuItem value="Eliminated">Eliminated</MenuItem></Select></FormControl>)}</>}
        {modal === 'roundFinish' && <><Typography>Complete {currentRound?.name}. All active applicants must have a locked evaluation or screening decision.</Typography><Alert severity="info">Completing a round records its evaluations and advances the workflow. Applicant progression is handled separately.</Alert></>}
        {modal === 'correctMark' && <><Typography>Original mark: {form.originalTotal} / {form.maxMarks}. The original remains in the audit record.</Typography><TextField label="Corrected mark" type="number" value={form.total ?? ''} onChange={(event) => setForm({ ...form, total: event.target.value })} /><TextField label="Reason" multiline minRows={2} value={form.reason || ''} onChange={(event) => setForm({ ...form, reason: event.target.value })} /><TextField label="Supporting evidence or reference" value={form.evidence || ''} onChange={(event) => setForm({ ...form, evidence: event.target.value })} /></>}
        {modal === 'exception' && <TextField label="What happened?" multiline minRows={4} value={form.reason || ''} onChange={(event) => setForm({ ...form, reason: event.target.value })} />}
        {modal === 'resolve' && <TextField label="Resolution and reason" multiline minRows={4} value={form.resolution || ''} onChange={(event) => setForm({ ...form, resolution: event.target.value })} />}
        {modal === 'interviewOverride' && <><Alert severity="warning">This records a Senate-authorized exception and permanently logs the reason and evidence.</Alert><FormControl><InputLabel>Override action</InputLabel><Select label="Override action" value={form.operation || 'markStudentComplete'} onChange={(event) => setForm({ ...form, operation: event.target.value })}><MenuItem value="markStudentComplete">Mark student complete</MenuItem><MenuItem value="terminate">Terminate interview</MenuItem><MenuItem value="releasePanel">Release panel</MenuItem></Select></FormControl>{form.operation === 'markStudentComplete' && <FormControl><InputLabel>Student</InputLabel><Select label="Student" value={form.userId || ''} onChange={(event) => setForm({ ...form, userId: event.target.value })}>{(data.sessions.find((session) => session.id === data.exceptions.find((item) => item.id === form.exceptionId)?.sessionId)?.students || []).map((student) => <MenuItem key={student} value={student}>{data.students.find((item) => item.id === student)?.name || student}</MenuItem>)}</Select></FormControl>}<TextField label="Reason" multiline minRows={2} value={form.reason || ''} onChange={(event) => setForm({ ...form, reason: event.target.value })} /><TextField label="Supporting evidence or reference" value={form.evidence || ''} onChange={(event) => setForm({ ...form, evidence: event.target.value })} /></>}
        {modal === 'submit' && <><TextField label="Submission title" value={form.name || ''} onChange={(event) => setForm({ ...form, name: event.target.value })} /><Button component="label" variant="outlined" disabled={uploadBusy}>{uploadBusy ? 'Uploading…' : form.fileKey ? `Ready: ${form.filename}` : 'Upload PDF, document, presentation, or ZIP'}<input hidden type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.zip" onChange={(event) => uploadTaskFile(event.target.files?.[0])} /></Button><Typography variant="caption" color="text.secondary">Maximum file size: 10 MB. Or provide a shareable HTTPS link below.</Typography><TextField label="Shareable HTTPS link" disabled={Boolean(form.fileKey)} value={form.url || ''} onChange={(event) => setForm({ ...form, url: event.target.value })} /></>}
        {modal === 'notifications' && <Stack>{(data?.notifications || []).slice().reverse().map((item) => <Paper variant="outlined" sx={{ p: 1.5 }} key={item.id}>{item.text}<Typography display="block" variant="caption">{formatDate(item.createdAt)}</Typography></Paper>)}{!(data?.notifications || []).length && <Empty>You are all caught up.</Empty>}</Stack>}
      </Stack></DialogContent><DialogActions>
        <Button onClick={() => setModal(null)}>Cancel</Button>
        {modal === 'stage' && <Button variant="contained" color={form.stage === 'completed' ? 'success' : form.stage === 'configuration' ? 'warning' : 'primary'} onClick={() => act('setPortalStage', form)}>Confirm stage change</Button>}
        {modal === 'schedulePortal' && <Button variant="contained" onClick={savePortalSchedule}>Save timings</Button>}
        {modal === 'policy' && <Button variant="contained" onClick={() => act('updatePolicy', form)}>Save policy</Button>}
        {modal === 'member' && <Button variant="contained" onClick={() => act('addMember', form)}>Assign access</Button>}

        {modal === 'panelStart' && <Button variant="contained" onClick={() => act('startPanelRun', form)}>Start panel</Button>}
        {modal === 'panelMarkIn' && <Button variant="contained" disabled={!form.userId} onClick={() => act('panelAttendance', { ...form, transition: 'ccaIn' })}>Mark student in</Button>}
        {modal === 'panelScore' && <Button variant="contained" disabled={form.total === '' || form.total == null} onClick={() => act(form.isEditing ? 'editPanelMarks' : 'savePanelMarks', form)}>{form.isEditing ? 'Save correction' : 'Submit marks'}</Button>}
        {modal === 'configure' && <Button variant="contained" onClick={saveConfiguration}>Save structure</Button>}
        {modal === 'round' && <Button variant="contained" disabled={uploadBusy} onClick={saveRound}>Save round</Button>}
        {modal === 'panel' && <Button variant="contained" onClick={() => act(form.panelId ? 'editPanel' : 'createPanel', { ...form, members: form.members || [] })}>{form.panelId ? 'Save panel' : 'Create panel'}</Button>}
        {modal === 'deletePanel' && <Button variant="contained" color="error" onClick={() => act('deletePanel', form)}>Delete panel</Button>}{modal === 'assignPanel' && <Button variant="contained" onClick={() => act('assignPanelStudents', form)}>Save assignments</Button>}
        {modal === 'group' && <Button variant="contained" onClick={() => act('createGroup', form)}>Assign group</Button>}
        {modal === 'schedule' && <Button variant="contained" disabled={!form.time} onClick={() => act('scheduleInterview', { ...form, time: new Date(form.time).toISOString() })}>Schedule</Button>}
        {modal === 'evaluate' && <Button variant="contained" disabled={!form.entries?.length || form.entries.some((entry) => entry.total === '')} onClick={() => act('lockEvaluation', form)}>Submit & lock</Button>}
        {modal === 'screen' && <Button variant="contained" disabled={!form.decisions?.length} onClick={() => act('screenApplicants', form)}>Lock decisions</Button>}
        {modal === 'roundFinish' && <Button variant="contained" color="warning" onClick={() => act('completeRound', form)}>Complete round</Button>}
        {modal === 'correctMark' && <Button variant="contained" disabled={!form.reason || !form.evidence || form.total === ''} onClick={() => act('correctMark', form)}>Authorize correction</Button>}
        {modal === 'exception' && <Button variant="contained" color="error" onClick={() => act('raiseException', form)}>Raise exception</Button>}
        {modal === 'resolve' && <Button variant="contained" onClick={() => act('resolveException', form)}>Record resolution</Button>}
        {modal === 'interviewOverride' && <Button variant="contained" color="warning" disabled={!form.reason || !form.evidence} onClick={() => act('overrideInterview', form)}>Authorize override</Button>}
        {modal === 'submit' && <Button variant="contained" disabled={uploadBusy || (!form.fileKey && !form.url)} onClick={() => act('submitTask', form)}>Submit task</Button>}
        {modal === 'notifications' && unread > 0 && <Button variant="contained" onClick={() => act('readNotifications')}>Mark all read</Button>}
      </DialogActions></Dialog>
      <Dialog open={Boolean(cvPreview)} onClose={() => setCvPreview(null)} fullWidth maxWidth="lg">
        <DialogTitle>{cvPreview?.application?.studentName || 'Applicant'} · CV</DialogTitle>
        <DialogContent dividers sx={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
          {cvPreview?.loading && <CircularProgress />}
          {cvPreview?.url && cvPreview.isPdf && <Box component="iframe" title={`${cvPreview.application.studentName} CV`} src={cvPreview.url} sx={{ display: 'block', width: '100%', height: '72vh', border: 0 }} />}
          {cvPreview?.url && !cvPreview.isPdf && <Alert severity="info">This file type can’t be previewed in the browser. Use “Download CV” to open it on your device.</Alert>}
        </DialogContent>
        <DialogActions>
          {cvPreview?.url && cvPreview.isPdf && <Button onClick={() => window.open(cvPreview.url, '_blank', 'noopener,noreferrer')}>Open CV in browser</Button>}
          {cvPreview?.url && <Button onClick={() => downloadApplicantCv(cvPreview.application)}>Download CV</Button>}
          <Button onClick={() => setCvPreview(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default SelectionWorkspacePage;
