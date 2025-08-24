import React, { useState } from 'react';
import { IconButton, Menu, MenuItem, Tooltip, ListItemText, ListItemIcon } from '@mui/material';
import CodeIcon from '@mui/icons-material/Code';
import { useTranslation } from 'react-i18next';

const VAR_KEYS = ['email', 'sender', 'recipient', 'subject'] as const;

interface VariableInsertMenuProps {
  idx: number;
  msg: { content: string | null };
  onInsert: (variable: string) => void;
}

export default function VariableInsertMenu({ idx, msg, onInsert }: VariableInsertMenuProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const { t } = useTranslation('common');

  return (
    <>
      <Tooltip title={t('prompts.variables.tooltip')}>
        <IconButton
          aria-label={t('prompts.variables.ariaLabel')}
          size="small"
          onClick={e => setAnchorEl(e.currentTarget)}
          sx={{ mt: 0.5 }}
        >
          <CodeIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {VAR_KEYS.map(k => (
          <MenuItem
            key={k}
            onClick={() => {
              onInsert(`{{${k}}}`);
              setAnchorEl(null);
            }}
          >
            <ListItemIcon><CodeIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary={`{{${k}}}`} secondary={t(`prompts.variables.items.${k}.description`)} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
