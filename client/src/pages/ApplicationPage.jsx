// client/src/pages/ApplicationPage.jsx
import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { Container, Grid, Chip, Paper, Typography, Button, Box, CircularProgress, Alert, IconButton, Divider, Dialog, DialogTitle, DialogContent, DialogActions, Stack } from '@mui/material';
import CCACard from '../components/CCACard';
import CVApplicationDialog from '../components/CVApplicationDialog';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

const ApplicationPage = () => {
  const OVERTURES_PHASE = 1;
  const [allCCAs, setAllCCAs] = useState([]);
  const [selectedCCAIds, setSelectedCCAIds] = useState(new Set());
  const [applicationCVs, setApplicationCVs] = useState(new Map());
  const [dialogCCA, setDialogCCA] = useState(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [portalStage, setPortalStage] = useState('applications');

  const navigate = useNavigate();

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const token = localStorage.getItem('token');
      const config = { headers: { 'x-auth-token': token } };

      try {
        const [ccasRes, userAppsRes, stageRes] = await Promise.all([
          axios.get(`http://localhost:5001/api/ccas?phase=${OVERTURES_PHASE}`),
          axios.get('http://localhost:5001/api/user/applications', config),
          axios.get('http://localhost:5001/api/selection/stage', config)
        ]);

        setAllCCAs(ccasRes.data);
        setSelectedCCAIds(new Set(userAppsRes.data.map(cca => cca._id)));
        setApplicationCVs(new Map(userAppsRes.data.filter((cca) => cca.applicationCvId).map((cca) => [cca._id, cca.applicationCvId])));
        setPortalStage(stageRes.data.stage);

      } catch (err) {
        if (err.response?.status === 401) {
          localStorage.removeItem('token');
          navigate('/login', { replace: true });
          return;
        }
        setError(err.response ? `Could not load application data (HTTP ${err.response.status}).` : 'Could not reach the local server. Please start the app again.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [navigate]);

  const openApplicationDialog = (cca) => {
    setDialogCCA(cca);
  };

  const handleApplicationConfirm = (cvId) => {
    const newSelection = new Set(selectedCCAIds);
    newSelection.add(dialogCCA._id);
    setSelectedCCAIds(newSelection);
    setApplicationCVs((current) => new Map(current).set(dialogCCA._id, cvId));
    setDialogCCA(null);
  };

  const handleRemoveApplication = () => {
    const newSelection = new Set(selectedCCAIds);
    newSelection.delete(dialogCCA._id);
    setSelectedCCAIds(newSelection);
    setApplicationCVs((current) => {
      const next = new Map(current);
      next.delete(dialogCCA._id);
      return next;
    });
    setDialogCCA(null);
  };

  const handleSave = async () => {
    try {
      const token = localStorage.getItem('token');
      const config = { headers: { 'x-auth-token': token } };
      const ccaIds = Array.from(selectedCCAIds);
      const applicationCVsPayload = ccaIds.filter((ccaId) => applicationCVs.has(ccaId)).map((ccaId) => ({ ccaId, cvId: applicationCVs.get(ccaId) }));
      await axios.post('http://localhost:5001/api/user/applications', { ccaIds, applicationCVs: applicationCVsPayload }, config);
      alert('Your selections have been saved!');
    } catch {
      alert('Failed to save selections.');
    }
  };

  const handleClearAll = async () => {
    try {
      const token = localStorage.getItem('token');
      await axios.post('http://localhost:5001/api/user/applications', { ccaIds: [], applicationCVs: [] }, { headers: { 'x-auth-token': token } });
      setSelectedCCAIds(new Set());
      setApplicationCVs(new Map());
      setClearDialogOpen(false);
    } catch {
      alert('Failed to clear applications.');
    }
  };

  const categoryOrder = ['Committees', 'Clubs', 'AIGs', 'Other'];
  const groupedCCAs = categoryOrder
    .map((category) => ({ category, items: allCCAs.filter((cca) => (cca.category || 'Other') === category) }))
    .filter(({ items }) => items.length > 0);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (portalStage !== 'applications') return (
    <Container maxWidth="sm" sx={{ mt: 8 }}>
      <Alert severity="info" sx={{ mb: 2 }}>
        Applications and rankings are closed. {portalStage === 'configuration' ? 'The CCAs and Senate are finalizing selection criteria and rounds.' : portalStage === 'selection' ? 'The selection workspace is now open.' : 'This selection cycle has been completed.'}
      </Alert>
      <Stack direction="row" spacing={1}>
        <Button variant="outlined" onClick={() => navigate('/home')}>Back home</Button>
        {portalStage === 'selection' && <Button variant="contained" onClick={() => navigate('/workspace')}>Open selection workspace</Button>}
      </Stack>
    </Container>
  );

  return (
     <Container maxWidth="lg" sx={{ my: 4 }}>
      {/* Frozen selection controls remain visible while the card list scrolls. */}
      <Paper
        elevation={3}
        sx={{ 
          position: 'sticky',
          top: 0,
          zIndex: 20,
          backgroundColor: '#fffdf7',
          borderBottom: '3px solid',
          borderColor: 'primary.main',
          py: 2, 
          px: 3,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 4,
          gap: 2,
          flexWrap: 'wrap'
        }}
      >
        <IconButton onClick={() => navigate('/home')} sx={{ mr: 2 }}>
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 220, textAlign: 'center' }}>
            <Typography variant="h4" component="h1">Choose Your Adventure</Typography>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 0.5, fontWeight: 700 }}>
              Overtures Phase {OVERTURES_PHASE}
            </Typography>
            <Chip
              label={`${selectedCCAIds.size} / 5 Selected`} 
              color="primary" 
              variant="filled"
              sx={{ mt: 1, fontSize: '1rem', fontWeight: 'bold' }}
            />
        </Box>
        <Button variant="contained" size="large" onClick={handleSave} sx={{ minWidth: 190 }}>
          Save Selections
        </Button>
        <Button variant="contained" color="error" size="large" onClick={() => setClearDialogOpen(true)} disabled={!selectedCCAIds.size} sx={{ minWidth: 190 }}>
          Clear all applications
        </Button>
      </Paper>

      {groupedCCAs.map(({ category, items }) => (
        <Box key={category} sx={{ mb: 5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, py: 1 }}>
            <Typography variant="h4" component="h2" sx={{ color: 'text.primary', flexShrink: 0 }}>{category}</Typography>
            <Divider sx={{ flex: 1 }} />
            <Chip label={`${items.length} options`} size="small" />
          </Box>
          <Grid container spacing={3}>
            {items.map((cca) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={cca._id}>
                <CCACard
                  cca={cca}
                  isSelected={selectedCCAIds.has(cca._id)}
                  isDisabled={selectedCCAIds.size >= 5}
                  onApply={() => openApplicationDialog({ ...cca, applicationCvId: applicationCVs.get(cca._id) || null })}
                  onChangeCV={() => openApplicationDialog({ ...cca, applicationCvId: applicationCVs.get(cca._id) || null })}
                  onRemove={() => {
                    setDialogCCA({ ...cca, applicationCvId: applicationCVs.get(cca._id) || null });
                  }}
                />
              </Grid>
            ))}
          </Grid>
        </Box>
      ))}
      <CVApplicationDialog
        open={Boolean(dialogCCA)}
        cca={dialogCCA}
        isApplied={Boolean(dialogCCA && selectedCCAIds.has(dialogCCA._id))}
        onClose={() => setDialogCCA(null)}
        onConfirm={handleApplicationConfirm}
        onRemove={handleRemoveApplication}
      />
      <Dialog open={clearDialogOpen} onClose={() => setClearDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ color: 'error.main', fontWeight: 800 }}>Clear all applications?</DialogTitle>
        <DialogContent>
          This will remove all of your current CCA selections. You can apply again later, but this action cannot be undone automatically.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearDialogOpen(false)}>Keep applications</Button>
          <Button color="error" variant="contained" onClick={handleClearAll}>Yes, clear all</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

export default ApplicationPage;
