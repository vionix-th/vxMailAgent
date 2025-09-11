import React from 'react';
import { Box, Stack, Button, Tooltip, IconButton, Switch, FormControlLabel } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import WrapTextIcon from '@mui/icons-material/WrapText';

export default function JsonPretty({ data, filename = 'data.json', maxHeight = 480, wrapDefault = true }: { data: any; filename?: string; maxHeight?: number; wrapDefault?: boolean }) {
  const [wrap, setWrap] = React.useState(wrapDefault);
  const pretty = React.useMemo(() => {
    try { return JSON.stringify(data, null, 2); } catch { return String(data); }
  }, [data]);

  const copy = async () => {
    try { await navigator.clipboard.writeText(pretty); } catch { /* noop */ }
  };

  const download = () => {
    try {
      const blob = new Blob([pretty], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch { /* noop */ }
  };

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
        <Tooltip title="Copy">
          <IconButton size="small" onClick={copy}>
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Download">
          <IconButton size="small" onClick={download}>
            <DownloadIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Toggle wrap">
          <IconButton size="small" onClick={() => setWrap(v => !v)}>
            <WrapTextIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
      <Box
        component="pre"
        sx={{
          backgroundColor: 'grey.100',
          p: 2,
          borderRadius: 1,
          overflow: 'auto',
          maxHeight,
          fontSize: '0.875rem',
          whiteSpace: wrap ? 'pre-wrap' : 'pre',
          wordBreak: wrap ? 'break-word' : 'normal'
        }}
      >
        {pretty}
      </Box>
    </Stack>
  );
}
