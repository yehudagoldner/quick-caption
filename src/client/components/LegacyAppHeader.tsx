import {
  AppBar,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
} from "@mui/material";
import { VideoLibraryRounded, HomeRounded, AccountBalanceWalletRounded, UploadFileOutlined } from "@mui/icons-material";
import { useAuth } from "../contexts/AuthContext";
import { useNarrowViewport } from "../hooks/useNarrowViewport";

import type { AppHeaderProps } from "./AppHeader";

export function LegacyAppHeader({
  user,
  authLoading,
  profileAnchorEl,
  currentPage,
  credits,
  onProfileClick,
  onProfileClose,
  onSignIn,
  onSignOut,
  onNavigate,
  onBuyCredits,
  navigationBlocked = false,
  isAdmin = false,
  onAdmin,
  onReportIssue,
}: AppHeaderProps) {
  const { isDevBypass } = useAuth();
  const narrow = useNarrowViewport();
  const creditsColor = credits === null ? "default" : credits < 20 ? "error" : credits < 50 ? "warning" : "success";

  return (
    <AppBar position="fixed" color="default" elevation={0} data-testid="app-header" sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Toolbar variant={narrow ? "dense" : "regular"} sx={narrow ? { minHeight: 48, px: 1 } : undefined}>
        <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", gap: 2 }}>
          <Box component="img" src={`${import.meta.env.BASE_URL}quickcaption-logo.svg`} alt="QuickCaption" sx={{ height: narrow ? 24 : 32 }} />
          {isDevBypass && !narrow && (
            <Chip size="small" color="warning" variant="outlined" label="משתמש דמה מקומי" />
          )}
          {user && (
            <Box sx={{ display: { xs: "none", md: "flex" }, gap: 1 }}>
              <Button
                startIcon={<HomeRounded />}
                variant={currentPage === "home" ? "contained" : "outlined"}
                onClick={() => onNavigate("home")}
                disabled={navigationBlocked}
                size="small"
              >
                דף הבית
              </Button>
              <Button
                startIcon={<VideoLibraryRounded />}
                variant={currentPage === "videos" ? "contained" : "outlined"}
                onClick={() => onNavigate("videos")}
                disabled={navigationBlocked}
                size="small"
              >
                היסטוריית סרטונים
              </Button>
              <Button
                startIcon={<UploadFileOutlined />}
                variant={currentPage === "transcription" ? "contained" : "outlined"}
                onClick={() => onNavigate("transcription")}
                disabled={navigationBlocked}
                size="small"
              >
                סרטון חדש
              </Button>
            </Box>
          )}
        </Box>
        {user ? (
          <>
            {credits !== null && (
              <Tooltip title={`יתרת קרדיטים: ${credits}`}>
                <Chip
                  icon={<AccountBalanceWalletRounded />}
                  label={`${credits} קרדיטים`}
                  color={creditsColor}
                  size="small"
                  sx={{ ml: narrow ? 0.5 : 2, fontWeight: "bold" }}
                />
              </Tooltip>
            )}
            <Tooltip title={user.displayName ?? user.email ?? "משתמש"}>
              <IconButton onClick={onProfileClick} size="small" sx={{ ml: 1 }}>
                <Avatar src={user.photoURL ?? undefined} alt={user.displayName ?? user.email ?? "User"} sx={{ width: 38, height: 38 }} />
              </IconButton>
            </Tooltip>
            <Menu
              anchorEl={profileAnchorEl}
              open={Boolean(profileAnchorEl)}
              onClose={onProfileClose}
              anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
              transformOrigin={{ horizontal: "right", vertical: "top" }}
            >
              <MenuItem disabled>{user.displayName ?? user.email ?? "משתמש"}</MenuItem>
              {credits !== null && (
                <MenuItem disabled>
                  קרדיטים: {credits}
                </MenuItem>
              )}

              <Box sx={{ display: { xs: "block", md: "none" } }}>
                <MenuItem disabled={navigationBlocked} onClick={() => { onProfileClose(); onNavigate("home"); }}>
                  <HomeRounded sx={{ ml: 1 }} />
                  דף הבית
                </MenuItem>
                <MenuItem disabled={navigationBlocked} onClick={() => { onProfileClose(); onNavigate("videos"); }}>
                  <VideoLibraryRounded sx={{ ml: 1 }} />
                  היסטוריית סרטונים
                </MenuItem>
                <MenuItem disabled={navigationBlocked} onClick={() => { onProfileClose(); onNavigate("transcription"); }}>
                  <UploadFileOutlined sx={{ ml: 1 }} />
                  סרטון חדש
                </MenuItem>
              </Box>

              <MenuItem disabled={navigationBlocked} onClick={() => { onProfileClose(); onBuyCredits(); }}>
                <AccountBalanceWalletRounded sx={{ ml: 1 }} />
                רכישת קרדיטים
              </MenuItem>
              {isAdmin && <MenuItem disabled={navigationBlocked} onClick={() => { onProfileClose(); onAdmin?.(); }}>ניהול</MenuItem>}
              {onReportIssue && <MenuItem onClick={() => { onProfileClose(); onReportIssue(); }}>דיווח על תקלה</MenuItem>}
              <MenuItem disabled={navigationBlocked} onClick={onSignOut}>התנתקות</MenuItem>
            </Menu>
          </>
        ) : (
          <Button
            color="primary"
            variant="contained"
            onClick={onSignIn}
            disabled={authLoading}
            startIcon={authLoading ? <CircularProgress size={18} color="inherit" /> : undefined}
          >
            {authLoading ? "מתחבר..." : "התחברות"}
          </Button>
        )}
      </Toolbar>
    </AppBar>
  );
}
