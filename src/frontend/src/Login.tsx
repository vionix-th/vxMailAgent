import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import { startGoogleLogin } from './authClient';

export default function Login() {
  const [loading, setLoading] = React.useState(false);
  const onGoogle = async () => {
    setLoading(true);
    try { await startGoogleLogin(); } finally { setLoading(false); }
  };
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
      <Stack spacing={2} sx={{ p: 4, border: '1px solid', borderColor: 'divider', borderRadius: 2, minWidth: 320 }}>
        <Typography variant="h6">Sign in</Typography>
        <Button variant="contained" color="primary" startIcon={<GoogleIcon />} onClick={onGoogle} disabled={loading}>
          Sign in with Google
        </Button>
      </Stack>
    </Box>
  );
}
