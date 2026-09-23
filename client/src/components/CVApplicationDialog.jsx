import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, Radio, RadioGroup, Stack, Typography, IconButton } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';

const CVApplicationDialog = ({ open, cca, isApplied, onClose, onConfirm, onRemove }) => {
  const [cvs, setCvs] = useState([]);
  const [selectedCvId, setSelectedCvId] = useState('');
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const loadCVs = async () => {
      setError('');
      try {
        const token = localStorage.getItem('token');
        const response = await axios.get('http://localhost:5001/api/user/cvs', { headers: { 'x-auth-token': token } });
        setCvs(response.data);
        setSelectedCvId(cca?.applicationCvId || response.data[0]?.id || '');
      } catch {
        setError('Could not load your saved CVs.');
      }
    };
    loadCVs();
  }, [open, cca]);

  const uploadCV = async () => {
    if (!file) return null;
    const formData = new FormData();
    formData.append('file', file);
    const token = localStorage.getItem('token');
    const response = await axios.post('http://localhost:5001/api/user/cvs', formData, { headers: { 'x-auth-token': token } });
    setCvs((current) => [...current, response.data]);
    setFile(null);
    setSelectedCvId(response.data.id);
    if (fileInputRef.current) fileInputRef.current.value = '';
    return response.data.id;
  };

  const handleConfirm = async () => {
    try {
      setLoading(true);
      setError('');
      const uploadedId = await uploadCV();
      const cvId = uploadedId || selectedCvId;
      if (!cvId) {
        setError('Upload a CV or choose one of your saved CVs.');
        return;
      }
      onConfirm(cvId);
    } catch (err) {
      setError(err.response?.data?.msg || 'Could not save this CV.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCV = async (cvId) => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`http://localhost:5001/api/user/cvs/${cvId}`, { headers: { 'x-auth-token': token } });
      const next = cvs.filter((cv) => cv.id !== cvId);
      setCvs(next);
      if (selectedCvId === cvId) setSelectedCvId(next[0]?.id || '');
    } catch (err) {
      setError(err.response?.data?.msg || 'Could not delete this CV.');
    }
  };

  if (!cca) return null;

  return (
    <Dialog open={open} onClose={loading ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isApplied ? `Change CV for ${cca.name}` : `Apply to ${cca.name}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {cvs.length === 0 ? 'Upload a CV to continue.' : 'Choose a saved CV or upload a new version. You can keep up to 3 CVs.'}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {cvs.length > 0 && (
            <FormControl>
              <RadioGroup value={selectedCvId} onChange={(event) => { setSelectedCvId(event.target.value); setFile(null); }}>
                {cvs.map((cv) => (
                  <Stack key={cv.id} direction="row" alignItems="center" justifyContent="space-between">
                    <FormControlLabel value={cv.id} control={<Radio />} label={cv.filename} />
                    <IconButton aria-label={`Delete ${cv.filename}`} size="small" onClick={() => handleDeleteCV(cv.id)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                  </Stack>
                ))}
              </RadioGroup>
            </FormControl>
          )}
          <Button component="label" variant="outlined" disabled={cvs.length >= 3 && !file} sx={{ justifyContent: 'flex-start', textTransform: 'none' }}>
            {file ? `Ready to upload: ${file.name}` : cvs.length >= 3 ? 'Maximum of 3 CVs reached' : 'Upload a new CV'}
            <input ref={fileInputRef} hidden type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { setFile(event.target.files?.[0] || null); setSelectedCvId(''); }} />
          </Button>
          <Typography variant="caption" color="text.secondary">PDF, DOC, or DOCX. Maximum size: 5 MB. Identical files are rejected.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        {isApplied && <Button variant="contained" color="error" onClick={onRemove} disabled={loading}>Remove application</Button>}
        <Button onClick={onClose} disabled={loading}>Cancel</Button>
        <Button variant="contained" color="primary" onClick={handleConfirm} disabled={loading || (!selectedCvId && !file)}>{loading ? 'Saving…' : isApplied ? 'Change CV' : 'Apply'}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default CVApplicationDialog;
