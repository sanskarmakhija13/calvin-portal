// client/src/pages/LoginPage.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Grid, Box, Paper, Typography, TextField, Button, Divider } from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import axios from 'axios'; // Or your api.js import

const LoginPage = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ email: '', password: '' });

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post('/api/auth/login', formData);
      localStorage.setItem('token', res.data.token);
      navigate('/home');
    } catch (error) {
      alert(`Login failed: ${error.response?.data?.msg || 'Server error'}`);
    }
  };

  return (
    <Grid container component="main" sx={{ height: '100vh' }}>
      {/* Left Side: Login Form */}
      <Grid 
        item 
        xs={12} 
        sm={8} 
        md={5} 
        component={Paper} 
        elevation={6} 
        square 
        sx={{ backgroundColor: '#fffdf7' }}
      >
        <Box
          sx={{
            my: 8,
            mx: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <Typography variant="h2" gutterBottom>
            Spaceman Spiff's ID Check
          </Typography>
          <Typography variant="body1" color="textSecondary" sx={{ mb: 3 }}>
            No transmogrifiers allowed.
          </Typography>

          <Box component="form" onSubmit={handleSubmit} sx={{ width: '100%' }}>
            <TextField
              variant="standard" margin="normal" required fullWidth
              id="email" label="Email" name="email"
              value={formData.email} onChange={handleChange}
            />
            <TextField
              variant="standard" margin="normal" required fullWidth
              name="password" label="Password" type="password" id="password"
              value={formData.password} onChange={handleChange}
            />
            <Button type="submit" fullWidth variant="contained" color="primary" sx={{ mt: 3, mb: 2, py: 1.5 }}>
              Let's Go Exploring!
            </Button>
          </Box>
          <Divider sx={{ width: '100%', my: 2 }}>OR</Divider>
          <Button fullWidth variant="outlined" startIcon={<GoogleIcon />} sx={{ py: 1.5 }}>
            Sign In with Google
          </Button>
        </Box>
      </Grid>

      {/* Right Side: Graphic */}
      <Grid
        item
        xs={false}
        sm={4}
        md={7}
        sx={{
          backgroundImage: 'url(/images/calvin-image.jpg)', // Make sure image is in public/images
          backgroundRepeat: 'no-repeat',
          backgroundColor: (t) => t.palette.mode === 'light' ? t.palette.grey[50] : t.palette.grey[900],
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      />
    </Grid>
  );
};

export default LoginPage;
