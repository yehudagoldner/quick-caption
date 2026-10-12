import {
  AppBar,
  Avatar,
  Box,
  Button,
  ButtonBase,
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
import { QaEnvironmentBadge } from "./QaEnvironmentBadge";

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
  onConnections,
  onReportIssue,
}: AppHeaderProps) {
  const { isDevBypass } = useAuth();
  const narrow = useNarrowViewport();
  const creditsColor = credits === null ? "default" : credits < 20 ? "error" : credits < 50 ? "warning" : "success";

  return (
    <AppBar position="fixed" color="default" elevation={0} data-testid="app-header" sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Toolbar variant={narrow ? "dense" : "regular"} sx={narrow ? { minHeight: 48, px: 1 } : undefined}>
        <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", gap: narrow ? 0.75 : 2 }}>
          <ButtonBase aria-label="Quick Caption — דף הבית" disabled={navigationBlocked} onClick={() => onNavigate("home")} sx={{ borderRadius: 1, flexShrink: 0 }}>
            <Box component="img" src={`${import.meta.env.BASE_URL}quickcaption-logo.svg`} alt="QuickCaption" sx={{ height: narrow ? 24 : 32 }} />
          </ButtonBase>
          <QaEnvironmentBadge onNavigate={() => { if (!navigationBlocked) onNavigate("premiere"); }} />
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
          <Tooltip title="התוסף ל־Premiere Pro">
            <Button
              onClick={() => onNavigate("premiere")}
              disabled={navigationBlocked}
              aria-label="תוסף לפרימייר"
              aria-current={currentPage === "premiere" ? "page" : undefined}
              variant="outlined"
              size="small"
              startIcon={
                <Box component="span" aria-hidden="true" dir="ltr" sx={{
                  display: "grid", placeItems: "center", width: 26, height: 26,
                  borderRadius: "6px", bgcolor: "#00005b", color: "#9999ff",
                  fontFamily: '"Segoe UI", sans-serif', fontSize: "17px !important",
                  fontWeight: 600, letterSpacing: "-0.5px", lineHeight: 1,
                }}>Pr</Box>
              }
              sx={{
                display: { xs: "none", md: "inline-flex" }, flexShrink: 0, minWidth: { xs: 34, md: 64 },
                gap: 0.5, px: { xs: 0.5, md: 1.5 }, py: 0.5, borderRadius: 2,
                "& .MuiButton-startIcon": { m: { xs: 0, md: undefined } },
                color: "#5142b5", borderColor: "#d8d1f5", bgcolor: "#f6f3ff",
                ...(currentPage === "premiere" ? { borderColor: "#5142b5", bgcolor: "#ece6ff" } : {}),
                whiteSpace: "nowrap",
                "&:hover": { bgcolor: "#ece6ff", borderColor: "#a89ae1" },
                "&.Mui-focusVisible": { outline: "2px solid #5142b5", outlineOffset: 2 },
              }}
            >
              <Box component="span" sx={{ display: { xs: "none", md: "inline" } }}>תוסף לפרימייר</Box>
            </Button>
          </Tooltip>
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
              {onConnections && <MenuItem disabled={navigationBlocked} onClick={() => { onProfileClose(); onConnections(); }}>החיבורים שלי</MenuItem>}
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
