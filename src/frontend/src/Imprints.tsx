import React, { useEffect, useState } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, IconButton, Snackbar, Alert
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { useCrudResource } from './hooks/useCrudResource';
import { randomId } from './utils/randomId';

interface Imprint {
  id: string;
  name: string;
  content: string;
}

const emptyImprint: Imprint = {
  id: '',
  name: '',
  content: '',
};

export default function Imprints() {
  const { items: imprints, create, update, remove, error, success, setError, setSuccess } = useCrudResource<Imprint>('/api/imprints');
  const [editing, setEditing] = useState<Imprint | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {}, []);

  const handleEdit = (imprint: Imprint) => { setEditing(imprint); setOpen(true); };
  const handleDelete = (id: string) => {
    void remove(id, { successMessage: 'Imprint deleted', errorMessage: 'Failed to delete imprint' });
  };
  const handleSave = () => {
    if (!editing) return;
    if (!editing.name || !editing.content) {
      setError('Name and Content are required');
      return;
    }
    const exists = imprints.find(i => i.id === editing.id);
    const action = exists
      ? update(editing.id, editing, { successMessage: 'Imprint updated', errorMessage: 'Failed to save imprint' })
      : create(editing, { successMessage: 'Imprint added', errorMessage: 'Failed to save imprint' });
    action.then(res => {
      if (res) {
        setOpen(false);
        setEditing(null);
      }
    });
  };

  return (
    <Box sx={{ maxWidth: '100%', mx: 'auto', mt: 2 }}>
      <Paper variant="outlined" sx={{ p: 3, overflow: 'hidden' }}>
      <Typography variant="h5" gutterBottom>Imprints</Typography>
      <Button variant="contained" color="primary" onClick={() => { setEditing({ ...emptyImprint, id: randomId() }); setOpen(true); }}>Add Imprint</Button>
      <TableContainer sx={{ mt: 2, overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Content</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {imprints.map(imprint => (
              <TableRow key={imprint.id}>
                <TableCell>{imprint.name}</TableCell>
                <TableCell><pre style={{ margin: 0, fontSize: 12 }}>{imprint.content.slice(0, 60)}{imprint.content.length > 60 ? '…' : ''}</pre></TableCell>
                <TableCell>
                  <IconButton onClick={() => handleEdit(imprint)}><EditIcon /></IconButton>
                  <IconButton onClick={() => handleDelete(imprint.id)}><DeleteIcon /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>{editing && imprints.find(i => i.id === editing.id) ? 'Edit Imprint' : 'Add Imprint'}</DialogTitle>
        <DialogContent>
          <TextField
            margin="dense"
            label="Name"
            fullWidth
            value={editing?.name || ''}
            onChange={e => setEditing(editing ? { ...editing, name: e.target.value } : null)}
          />
          <TextField
            margin="dense"
            label="Content"
            fullWidth
            multiline
            minRows={3}
            value={editing?.content || ''}
            onChange={e => setEditing(editing ? { ...editing, content: e.target.value } : null)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleSave} variant="contained">Save</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      </Snackbar>
      <Snackbar open={!!success} autoHideDuration={4000} onClose={() => setSuccess(null)}>
        <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>
      </Snackbar>
      </Paper>
    </Box>
  );
}
