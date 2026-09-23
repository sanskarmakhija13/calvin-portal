// client/src/theme.js
import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    primary: {
      main: '#F1882D', // Energetic Orange
    },
    secondary: {
      main: '#222222', // Inky Black
    },
    error: {
      main: '#D33E42', // Calvin's Shirt Red
    },
    background: {
      default: '#FDF8E3', // Newsprint Paper
    },
    text: {
      primary: '#222222', // Inky Black for text
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h1: {
      fontFamily: '"Bangers", cursive',
      fontSize: '4.5rem',
      letterSpacing: '0.1rem',
    },
    h2: {
      fontFamily: '"Bangers", cursive',
    },
    h3: {
      fontFamily: '"Bangers", cursive',
    },
    h4: {
      fontFamily: '"Bangers", cursive',
    },
    button: {
        fontWeight: 700,
        textTransform: 'none', // Buttons will use regular casing
    }
  },
});

export default theme;