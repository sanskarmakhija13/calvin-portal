// client/src/pages/HomePage.jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Alert, Chip, Container, Grid, Typography, Box } from '@mui/material';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch'; // For "Apply"
import MilitaryTechIcon from '@mui/icons-material/MilitaryTech'; // For "Rank"
import HubIcon from '@mui/icons-material/Hub';

// Reusable Card Style Component
const ThemedCard = ({ to, title, subtitle, bgImage, children }) => (
  <Grid item xs={12} md={6}>
    <Box
      component={Link}
      to={to}
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 250,
        borderRadius: 2,
        padding: 4,
        overflow: 'hidden',
        textDecoration: 'none',
        boxShadow: '0px 4px 20px rgba(0, 0, 0, 0.1)',
        transition: 'transform 0.3s ease-in-out, box-shadow 0.3s ease-in-out',
        '&:hover': {
          transform: 'scale(1.05)',
          boxShadow: '0px 10px 30px rgba(0, 0, 0, 0.2)',
        },
        // Background Image
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 0, left: 0,
          width: '100%', height: '100%',
          backgroundImage: `url(${bgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          zIndex: 1,
          transition: 'transform 0.3s ease-in-out',
        },
        '&:hover::after': {
            transform: 'scale(1.1)',
        },
        // Color Overlay
        '&::before': {
            content: '""',
            position: 'absolute',
            top: 0, left: 0,
            width: '100%', height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.4)', // Dark overlay for text contrast
            zIndex: 2,
        }
      }}
    >
      <Box sx={{ color: 'white', textAlign: 'center', position: 'relative', zIndex: 3 }}>
        {children}
        <Typography variant="h3" component="h2" sx={{ fontFamily: '"Bangers", cursive' }}>
          {title}
        </Typography>
        <Typography variant="body1">{subtitle}</Typography>
      </Box>
    </Box>
  </Grid>
);

const HomePage = () => {
  const [stage, setStage] = useState('applications');
  useEffect(() => {
    const token = localStorage.getItem('token');
    axios.get('/api/selection/stage', { headers: { 'x-auth-token': token } })
      .then((response) => setStage(response.data.stage))
      .catch(() => {});
  }, []);
  const stages = {
    applications: ['Applications open', 'Apply and rank your CCA choices now.', 'success'],
    configuration: ['Applications closed', 'CCAs and Senate are finalizing criteria, rounds, and panels.', 'warning'],
    selection: ['Selection workspace open', 'Tasks, interviews, evaluations, and results are now active.', 'info'],
    completed: ['Selection cycle completed', 'The published cycle is now read-only.', 'success']
  };
  const current = stages[stage] || stages.applications;

  return (
    <Container maxWidth="lg" sx={{ mt: 8, mb: 8 }}>
      <Typography variant="h2" align="center" gutterBottom>
        What mischief are we managing today?
      </Typography>
      <Alert severity={current[2]} sx={{ mt: 2 }} icon={<Chip size="small" label={current[0]} color={current[2] === 'info' ? 'primary' : current[2]} />}>
        {current[1]}
      </Alert>
      <Grid container spacing={4} sx={{ mt: 4 }}>
        <ThemedCard
          to="/apply"
          title="Start a New Mission"
          subtitle="Apply to Clubs & Committees"
          bgImage="/images/apply-bg.png"
        >
          <RocketLaunchIcon sx={{ fontSize: 60, mb: 1 }} />
        </ThemedCard>
        
        <ThemedCard
          to="/rank"
          title="Organize The Loot"
          subtitle="Rank Your Top Choices"
          bgImage="/images/rank-bg.png"
        >
          <MilitaryTechIcon sx={{ fontSize: 60, mb: 1 }} />
        </ThemedCard>

        <ThemedCard
          to="/workspace"
          title="Selection Workspace"
          subtitle="Applications, rounds, interviews, evaluations & results"
          bgImage="/images/calvin-image.jpg"
        >
          <HubIcon sx={{ fontSize: 60, mb: 1 }} />
        </ThemedCard>
      </Grid>
    </Container>
  );
};

export default HomePage;
