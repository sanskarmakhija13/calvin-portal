import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Box, Container, Card, Typography, Button, IconButton, CircularProgress, List, ListItemText, Tooltip, Paper, Chip, Stack, Alert } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';

const RankingPage = () => {
  const navigate = useNavigate();
  const [rankedCCAs, setRankedCCAs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [portalStage, setPortalStage] = useState('applications');

  useEffect(() => {
    const fetchAppliedCCAs = async () => {
      const token = localStorage.getItem('token');
      try {
        const [applicationsResponse, stageResponse] = await Promise.all([
          axios.get('/api/user/applications', { headers: { 'x-auth-token': token } }),
          axios.get('/api/selection/stage', { headers: { 'x-auth-token': token } })
        ]);
        setRankedCCAs(applicationsResponse.data);
        setPortalStage(stageResponse.data.stage);
      } catch (err) {
        if (err.response?.status === 401) {
          localStorage.removeItem('token');
          navigate('/login', { replace: true });
          return;
        }
        setError(err.response ? `Could not load rankings (HTTP ${err.response.status}).` : 'Could not reach the local server. Please start the app again.');
      } finally {
        setLoading(false);
      }
    };
    fetchAppliedCCAs();
  }, [navigate]);

  const handleOnDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(rankedCCAs);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);
    setRankedCCAs(items);
  };

  const moveRank = (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= rankedCCAs.length) return;
    const items = Array.from(rankedCCAs);
    [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
    setRankedCCAs(items);
  };

  const handleSaveRanks = async () => {
    try {
      const token = localStorage.getItem('token');
      await axios.post('/api/user/rankings', { rankedCcaIds: rankedCCAs.map((cca) => cca._id) }, { headers: { 'x-auth-token': token } });
      alert('Your ranking has been saved!');
      navigate('/home');
    } catch {
      alert('Failed to save ranking.');
    }
  };

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}><CircularProgress /></Box>;
  if (error) return <Alert severity="error" sx={{ m: 3 }}>{error}</Alert>;
  if (portalStage !== 'applications') return <Container maxWidth="sm" sx={{ mt: 8 }}><Alert severity="info" sx={{ mb: 2 }}>Rankings are locked because the application window has closed.</Alert><Button variant="contained" onClick={() => navigate(portalStage === 'selection' ? '/workspace' : '/home')}>{portalStage === 'selection' ? 'Open selection workspace' : 'Back home'}</Button></Container>;

  return (
    <Container maxWidth="md" sx={{ mt: 3, pb: 12, width: '100%', overflowX: 'hidden' }}>
      <Paper elevation={3} sx={{ position: 'sticky', top: 0, zIndex: 10, p: { xs: 2, sm: 2.5 }, mb: 3, backgroundColor: '#fffdf7', borderBottom: '3px solid', borderColor: 'primary.main' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'stretch', sm: 'center' }} spacing={2}>
          <IconButton onClick={() => navigate('/home')} aria-label="Back to home" sx={{ alignSelf: { xs: 'flex-start', sm: 'center' } }}><ArrowBackIcon /></IconButton>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h3" component="h1" sx={{ lineHeight: 1 }}>Rank Your Choices</Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>Drag by the handle or use the arrows to set your preference.</Typography>
          </Box>
          <Chip color="primary" label={`${rankedCCAs.length} choices`} sx={{ alignSelf: { xs: 'flex-start', sm: 'center' }, fontWeight: 700 }} />
        </Stack>
      </Paper>

      {rankedCCAs.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center', backgroundColor: '#fffdf7' }}><Typography>You have not selected any CCAs yet.</Typography></Paper>
      ) : (
        <DragDropContext onDragEnd={handleOnDragEnd}>
          <Droppable droppableId="ccas">
            {(provided) => (
              <List {...provided.droppableProps} ref={provided.innerRef} disablePadding sx={{ width: '100%' }}>
                {rankedCCAs.map((cca, index) => (
                  <Draggable key={cca._id} draggableId={cca._id} index={index}>
                    {(provided) => (
                      <Box
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        style={{
                          ...provided.draggableProps.style,
                          // Keep the measured row width when the drag library moves it out of flow.
                          width: provided.draggableProps.style?.width || '100%',
                          maxWidth: '100%',
                          boxSizing: 'border-box',
                        }}
                        sx={{ width: '100%', display: 'block', mb: 1.5 }}
                      >
                        <Card sx={{ width: '100%', minWidth: 0, display: 'flex', alignItems: 'stretch', backgroundColor: '#fffdf7', borderLeft: `5px solid ${cca.brandColor || '#f58220'}`, overflow: 'hidden' }}>
                          <Box sx={{ p: { xs: 1.5, sm: 2 }, minWidth: { xs: 58, sm: 72 }, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'primary.main', color: 'white' }}>
                            <Typography variant="h4" sx={{ fontFamily: '"Bangers", cursive' }}>{index + 1}</Typography>
                          </Box>
                          <Box {...provided.dragHandleProps} sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, py: 1.25, px: { xs: 1.5, sm: 2 }, cursor: 'grab' }}>
                            <DragIndicatorIcon color="disabled" sx={{ mr: 1, flexShrink: 0 }} aria-hidden="true" />
                            <Box sx={{ width: 42, height: 42, borderRadius: '50%', overflow: 'hidden', bgcolor: '#fff', border: `2px solid ${cca.brandColor || '#f58220'}`, display: 'grid', placeItems: 'center', mr: 1.5, flexShrink: 0 }}>
                              {cca.logo ? <Box component="img" src={cca.logo} alt="" sx={{ width: '100%', height: '100%', objectFit: 'contain', p: 0.3 }} /> : <Typography variant="caption" sx={{ fontWeight: 800 }}>{(cca.logoText || cca.name.slice(0, 2)).slice(0, 4)}</Typography>}
                            </Box>
                            <ListItemText primary={cca.name} secondary={cca.description} sx={{ minWidth: 0, '& .MuiListItemText-primary, & .MuiListItemText-secondary': { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }} />
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', pr: { xs: 0.5, sm: 1 } }}>
                            <Tooltip title="Move up"><span><IconButton aria-label={`Move ${cca.name} up`} onClick={() => moveRank(index, -1)} disabled={index === 0} size="small"><ArrowUpwardIcon /></IconButton></span></Tooltip>
                            <Tooltip title="Move down"><span><IconButton aria-label={`Move ${cca.name} down`} onClick={() => moveRank(index, 1)} disabled={index === rankedCCAs.length - 1} size="small"><ArrowDownwardIcon /></IconButton></span></Tooltip>
                          </Box>
                        </Card>
                      </Box>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </List>
            )}
          </Droppable>
        </DragDropContext>
      )}

      <Paper elevation={4} sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 12, py: 1.5, display: 'flex', justifyContent: 'center', backgroundColor: 'rgba(255,253,247,0.96)', backdropFilter: 'blur(6px)' }}>
        <Button variant="contained" size="large" onClick={handleSaveRanks} disabled={!rankedCCAs.length}>Save Ranking</Button>
      </Paper>
    </Container>
  );
};

export default RankingPage;
