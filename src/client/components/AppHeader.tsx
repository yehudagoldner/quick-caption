import type { MouseEvent } from "react";
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
import type { AuthUser } from "../hooks/useTranscriptionWorkflow";
import { useAuth } from "../contexts/AuthContext";
import { useNarrowViewport } from "../hooks/useNarrowViewport";

type HeaderPage = "home" | "videos" | "transcription";

type AppHeaderProps = {
  user: AuthUser;
  authLoading: boolean;
  profileAnchorEl: HTMLElement | null;
  currentPage: HeaderPage;
  credits: number | null;
  onProfileClick: (event: MouseEvent<HTMLElement>) => void;
  onProfileClose: () => void;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onNavigate: (page: HeaderPage) => void;
  onBuyCredits: () => void;
};

export function AppHeader({
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
}: AppHeaderProps) {
  const { isDevBypass } = useAuth();
  const narrow = useNarrowViewport();
  const creditsColor = credits === null ? "default" : credits < 20 ? "error" : credits < 50 ? "warning" : "success";

  return (
    <AppBar position="fixed" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Toolbar variant={narrow ? "dense" : "regular"} sx={narrow ? { minHeight: 48, px: 1 } : undefined}>
        <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", gap: 2 }}>
          <Box component="img" src="/quickcaption-logo.svg" alt="QuickCaption" sx={{ height: narrow ? 24 : 32 }} />
          {isDevBypass && !narrow && (
            <Chip size="small" color="warning" variant="outlined" label="משתמש דמה מקומי" />
          )}
          {user && (
            <Box sx={{ display: { xs: "none", md: "flex" }, gap: 1 }}>
              <Button
                startIcon={<HomeRounded />}
                variant={currentPage === "home" ? "contained" : "outlined"}
                onClick={() => onNavigate("home")}
                size="small"
              >
                דף הבית
              </Button>
              <Button
                startIcon={<VideoLibraryRounded />}
                variant={currentPage === "videos" ? "contained" : "outlined"}
                onClick={() => onNavigate("videos")}
                size="small"
              >
                היסטוריית סרטונים
              </Button>
              <Button
                startIcon={<UploadFileOutlined />}
                variant={currentPage === "transcription" ? "contained" : "outlined"}
                onClick={() => onNavigate("transcription")}
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
              <Tooltip title={`יתרת קרדיטים: ${credits} (${(credits / 100).toFixed(2)}$)`}>
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
                <MenuItem onClick={() => { onProfileClose(); onNavigate("home"); }}>
                  <HomeRounded sx={{ ml: 1 }} />
                  דף הבית
                </MenuItem>
                <MenuItem onClick={() => { onProfileClose(); onNavigate("videos"); }}>
                  <VideoLibraryRounded sx={{ ml: 1 }} />
                  היסטוריית סרטונים
                </MenuItem>
                <MenuItem onClick={() => { onProfileClose(); onNavigate("transcription"); }}>
                  <UploadFileOutlined sx={{ ml: 1 }} />
                  סרטון חדש
                </MenuItem>
              </Box>

              <MenuItem onClick={() => { onProfileClose(); onBuyCredits(); }}>
                <AccountBalanceWalletRounded sx={{ ml: 1 }} />
                רכישת קרדיטים
              </MenuItem>
              <MenuItem onClick={onSignOut}>התנתקות</MenuItem>
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
