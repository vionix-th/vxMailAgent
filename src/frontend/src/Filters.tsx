import React, { useEffect, useState } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, TextField, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, IconButton, Snackbar, Alert, Checkbox, FormControlLabel
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useTranslation } from 'react-i18next';

export type FilterField = 'from' | 'to' | 'cc' | 'bcc' | 'subject' | 'body' | 'date';

interface Director {
  id: string;
  name: string;
}

interface Filter {
  id: string;
  field: FilterField;
  regex: string;
  directorId: string;
  duplicateAllowed?: boolean;
}

const emptyFilter: Filter = {
  id: '',
  field: 'from',
  regex: '',
  directorId: '',
  duplicateAllowed: false,
};

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

export default function Filters() {
  const [filters, setFilters] = useState<Filter[]>([]);
  const [directors, setDirectors] = useState<Director[]>([]);
  const [editing, setEditing] = useState<Filter | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { t } = useTranslation('common');

  useEffect(() => {
    fetch('/api/filters').then(r => r.json()).then(setFilters).catch(() => setError(t('filters.errors.failedLoadFilters')));
    fetch('/api/directors').then(r => r.json()).then(setDirectors).catch(() => setError(t('filters.errors.failedLoadDirectors')));
  }, []);

  const handleEdit = (filter: Filter) => {
    setEditing(filter);
    setOpen(true);
  };

  const handleDelete = (id: string) => {
    fetch(`/api/filters/${id}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(() => { setFilters(filters.filter(f => f.id !== id)); setSuccess(t('filters.messages.deleted')); })
      .catch(() => setError(t('filters.errors.failedDelete')));
  };

  const persistReorder = (ordered: Filter[]) => {
    setFilters(ordered);
    fetch('/api/filters/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: ordered.map(f => f.id) }),
    })
      .then(r => {
        if (!r.ok) throw new Error('Failed');
        setSuccess(t('filters.messages.orderUpdated'));
      })
      .catch(() => setError(t('filters.errors.failedOrder')));
  };

  const moveUp = (id: string) => {
    const idx = filters.findIndex(f => f.id === id);
    if (idx <= 0) return;
    const next = filters.slice();
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    persistReorder(next);
  };

  const moveDown = (id: string) => {
    const idx = filters.findIndex(f => f.id === id);
    if (idx === -1 || idx >= filters.length - 1) return;
    const next = filters.slice();
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    persistReorder(next);
  };

  const handleSave = () => {
    if (!editing) return;
    if (!editing.regex || !editing.directorId) {
      setError(t('filters.errors.missingRegexDirector'));
      return;
    }
    const method = filters.find(f => f.id === editing.id) ? 'PUT' : 'POST';
    const url = method === 'POST' ? '/api/filters' : `/api/filters/${editing.id}`;
    fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editing),
    })
      .then(r => r.json())
      .then(() => {
        setOpen(false);
        setEditing(null);
        fetch('/api/filters').then(r => r.json()).then(setFilters);
        setSuccess(method === 'POST' ? t('filters.messages.added') : t('filters.messages.updated'));
      })
      .catch(() => setError(t('filters.errors.failedSave')));
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h5">{t('filters.title')}</Typography>
        <Button variant="contained" color="primary" onClick={() => { setEditing({ ...emptyFilter, id: randomId() }); setOpen(true); }}>{t('filters.addTitle')}</Button>
      </Box>
      <TableContainer sx={{ mt: 1 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('filters.table.field')}</TableCell>
              <TableCell>{t('filters.table.regex')}</TableCell>
              <TableCell>{t('filters.table.duplicate')}</TableCell>
              <TableCell>{t('filters.table.director')}</TableCell>
              <TableCell>{t('filters.table.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filters.map(filter => (
              <TableRow key={filter.id}>
                <TableCell>{t(`filters.fields.${filter.field}`)}</TableCell>
                <TableCell>{filter.regex}</TableCell>
                <TableCell>{filter.duplicateAllowed ? t('labels.yes') : t('labels.no')}</TableCell>
                <TableCell>{directors.find(d => d.id === filter.directorId)?.name || filter.directorId}</TableCell>
                <TableCell>
                  <IconButton onClick={() => moveUp(filter.id)} title={t('filters.tooltips.moveUp')}><ArrowUpwardIcon /></IconButton>
                  <IconButton onClick={() => moveDown(filter.id)} title={t('filters.tooltips.moveDown')}><ArrowDownwardIcon /></IconButton>
                  <IconButton onClick={() => handleEdit(filter)} title={t('filters.tooltips.edit')}><EditIcon /></IconButton>
                  <IconButton onClick={() => handleDelete(filter.id)} title={t('filters.tooltips.delete')}><DeleteIcon /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>{editing && filters.find(f => f.id === editing.id) ? t('filters.editTitle') : t('filters.addTitle')}</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>{t('filters.form.field')}</InputLabel>
            <Select
              value={editing?.field || 'from'}
              label={t('filters.form.field')}
              onChange={e => setEditing(editing ? { ...editing, field: e.target.value as FilterField } : null)}
            >
              {['from', 'to', 'cc', 'bcc', 'subject', 'body', 'date'].map(f => (
                <MenuItem key={f} value={f}>{t(`filters.fields.${f}`)}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            margin="dense"
            label={t('filters.form.regex')}
            fullWidth
            value={editing?.regex || ''}
            onChange={e => setEditing(editing ? { ...editing, regex: e.target.value } : null)}
          />
          <FormControlLabel
            sx={{ mt: 1 }}
            control={
              <Checkbox
                checked={!!editing?.duplicateAllowed}
                onChange={(e) => setEditing(editing ? { ...editing, duplicateAllowed: e.target.checked } : null)}
              />
            }
            label={t('filters.form.duplicateLabel')}
          />
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>{t('filters.form.director')}</InputLabel>
            <Select
              value={editing?.directorId || ''}
              label={t('filters.form.director')}
              onChange={e => setEditing(editing ? { ...editing, directorId: e.target.value } : null)}
            >
              {directors.map(d => (
                <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('actions.cancel')}</Button>
          <Button onClick={handleSave} variant="contained">{t('actions.save')}</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!error} autoHideDuration={6000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>
      </Snackbar>
      <Snackbar open={!!success} autoHideDuration={4000} onClose={() => setSuccess(null)}>
        <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>
      </Snackbar>
    </Paper>
  );
}

