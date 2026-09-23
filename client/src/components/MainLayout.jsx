// client/src/components/MainLayout.jsx
import { useEffect, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { AppBar, Toolbar, Typography, Button, Box, Menu, MenuItem } from '@mui/material';

const MainLayout = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('Account');
  const [anchorEl, setAnchorEl] = useState(null);
  const displayName = email.includes('@') ? email.split('@')[0] : email;

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    axios.get('http://localhost:5001/api/user/me', {
      headers: { 'x-auth-token': token },
    }).then((res) => {
      setEmail(res.data.email);
    }).catch(() => {
      setEmail('Account');
    });
  }, []);

  const handleLogout = () => {
    setAnchorEl(null);
    localStorage.removeItem('token');
    navigate('/login');
  };

  return (
    <Box>
      <AppBar position="static" color="secondary">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontFamily: '"Bangers", cursive', letterSpacing: '0.08em' }}>
            CALVIN
          </Typography>
          <Button
            color="inherit"
            onClick={(event) => setAnchorEl(event.currentTarget)}
            aria-controls={anchorEl ? 'account-menu' : undefined}
            aria-haspopup="true"
            aria-expanded={anchorEl ? 'true' : undefined}
            sx={{ textTransform: 'none' }}
          >
            {displayName}
          </Button>
          <Menu
            id="account-menu"
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={() => setAnchorEl(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <MenuItem onClick={handleLogout}>Log out</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      <main>
        {/* The actual page content will be rendered here */}
        <Outlet />
      </main>
    </Box>
  );
};

export default MainLayout;
