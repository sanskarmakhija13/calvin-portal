// client/src/components/CCACard.jsx
import { Card, CardContent, Typography, Button, Box, Chip, Stack } from '@mui/material';

const CCACard = ({ cca, isSelected, onApply, onChangeCV, onRemove, isDisabled }) => {
  const initials = cca.logoText || cca.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  const events = (cca.majorEvents || []).slice(0, 3).join(' · ');

  return (
    <Card
      sx={{
        position: 'relative',
        height: '100%',
        minHeight: 330,
        borderTop: `5px solid ${cca.brandColor || '#f58220'}`,
        transition: 'transform 0.2s ease-in-out, box-shadow 0.2s ease-in-out',
        backgroundColor: isSelected ? '#fff3e0' : '#fffdf7', // Light orange when selected
        overflow: 'hidden',
        border: isSelected ? '2px solid' : '2px solid transparent',
        borderColor: 'primary.main',
        '&:hover': {
          transform: 'translateY(-5px)',
          boxShadow: 6,
        },
      }}
    >
      <CardContent sx={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100%', p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 58 }}>
          {cca.logo ? (
            <Box sx={{ width: 58, height: 58, display: 'grid', placeItems: 'center', flexShrink: 0, borderRadius: '50%', overflow: 'hidden', bgcolor: '#fff', border: `2px solid ${cca.brandColor || '#f58220'}` }}>
              <Box component="img" src={cca.logo} alt={`${cca.name} logo`} sx={{ width: '100%', height: '100%', objectFit: 'contain', p: 0.5 }} />
            </Box>
          ) : (
            <Box sx={{ width: 58, height: 58, display: 'grid', placeItems: 'center', flexShrink: 0, borderRadius: '50%', bgcolor: cca.brandColor || '#f58220', color: '#fff', fontWeight: 800, fontSize: '0.7rem', textAlign: 'center', px: 0.5 }}>{initials}</Box>
          )}
          <Typography variant="h5" sx={{ fontFamily: cca.fontFamily || '"Bangers", cursive', letterSpacing: '0.5px', lineHeight: 1.05 }}>
            {cca.name}
          </Typography>
        </Box>
        <Box sx={{ flexGrow: 1 }}>
          {isSelected && <Chip label="Applied" color="success" size="small" sx={{ mt: 1, fontWeight: 700 }} />}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, minHeight: 42 }}>
            {cca.description}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Chip size="small" label={`Members: ${cca.memberLimit || '—'}`} sx={{ bgcolor: '#fff3e0' }} />
            <Chip size="small" label={`STEX: ${cca.stexLimit || '—'}`} sx={{ bgcolor: '#fff3e0' }} />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25, lineHeight: 1.35 }}>
            <strong>Major events:</strong> {events || 'See materials'}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', rowGap: 1 }}>
          {isSelected ? (
            <>
              <Button variant="contained" color="primary" onClick={onChangeCV}>Change CV</Button>
              <Button variant="contained" color="error" onClick={onRemove}>Remove application</Button>
            </>
          ) : (
            <Button variant="outlined" onClick={onApply} disabled={isDisabled}>Apply</Button>
          )}
          <Button variant="text" href={cca.driveUrl || undefined} target="_blank" rel="noreferrer" sx={{ color: cca.brandColor || 'primary.main' }}>
            View materials
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
};

export default CCACard;
