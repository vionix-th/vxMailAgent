import React from 'react';
import { Box, Button, Stack, Typography, Link, Card, CardContent, Divider } from '@mui/material';
import GoogleIcon from '@mui/icons-material/Google';
import GitHubIcon from '@mui/icons-material/GitHub';
import ArticleIcon from '@mui/icons-material/Article';
import { startGoogleLogin } from './authClient';
import logo from '@shared/site-logo.png';

export default function Login() {
  const [loading, setLoading] = React.useState(false);
  const onGoogle = async () => {
    setLoading(true);
    try { await startGoogleLogin(); } finally { setLoading(false); }
  };
  return (
    <Box
      sx={{
        display: 'grid',
        placeItems: 'center',
        height: '100vh',
        bgcolor: 'background.default',
        // Soft gradient background with subtle spotlight
        backgroundImage: (theme) =>
          theme.palette.mode === 'dark'
            ? 'radial-gradient(800px 800px at 120% -20%, rgba(122,162,247,0.10) 0%, rgba(0,0,0,0) 60%), linear-gradient(180deg, rgba(12,14,22,0) 0%, rgba(80,90,140,0.12) 100%)'
            : 'radial-gradient(800px 800px at 120% -20%, rgba(46,125,233,0.08) 0%, rgba(0,0,0,0) 60%), linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(46,125,233,0.06) 100%)',
        backgroundRepeat: 'no-repeat',
      }}
    >
      <Card sx={{ width: 420, maxWidth: '90vw' }}>
        <CardContent>
          <Stack spacing={2} alignItems="center">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <img src={logo} alt="Vionix Consulting" width={40} height={40} style={{ borderRadius: 8 }} />
              <Box>
                <Typography variant="h5" sx={{ lineHeight: 1.1 }}>Vionix Consulting</Typography>
                <Typography variant="body2" color="text.secondary">vxMailAgent</Typography>
              </Box>
            </Box>

            <Typography variant="body2" color="text.secondary" align="center">
              Sign in to continue to your workspace.
            </Typography>

            <Button
              fullWidth
              size="medium"
              variant="contained"
              color="primary"
              startIcon={<GoogleIcon />}
              onClick={onGoogle}
              disabled={loading}
            >
              {loading ? 'Connecting…' : 'Continue with Google'}
            </Button>

            <Divider flexItem>
              <Typography variant="caption" color="text.secondary">About</Typography>
            </Divider>

            <Stack direction="row" spacing={2} sx={{ color: 'text.secondary' }}>
              <Link
                href="https://github.com/vionix-th/vxMailAgent"
                target="_blank"
                rel="noreferrer"
                underline="hover"
                display="inline-flex"
                alignItems="center"
                gap={0.75}
              >
                <GitHubIcon fontSize="small" /> Repository
              </Link>
              <Link
                href="https://github.com/vionix-th/vxMailAgent/blob/main/docs/DEVELOPER.md"
                target="_blank"
                rel="noreferrer"
                underline="hover"
                display="inline-flex"
                alignItems="center"
                gap={0.75}
              >
                <ArticleIcon fontSize="small" /> Docs
              </Link>
            </Stack>

            <Typography variant="caption" color="text.disabled" align="center">
              {new Date().getFullYear()} Vionix Consulting
            </Typography>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
