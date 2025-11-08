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
import { VideoLibraryRounded, HomeRounded, AccountBalanceWalletRounded } from "@mui/icons-material";
import type { AuthUser } from "../hooks/useTranscriptionWorkflow";

type AppHeaderProps = {
  user: AuthUser;
  authLoading: boolean;
  profileAnchorEl: HTMLElement | null;
  currentPage: "home" | "videos";
  credits: number | null;
  onProfileClick: (event: MouseEvent<HTMLElement>) => void;
  onProfileClose: () => void;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onNavigate: (page: "home" | "videos") => void;
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
  const creditsColor = credits === null ? "default" : credits < 20 ? "error" : credits < 50 ? "warning" : "success";

  return (
    <AppBar position="fixed" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Toolbar>
        <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", gap: 2 }}>
          <Box component="img" src="/quickcaption-logo.svg" alt="QuickCaption" sx={{ height: 32 }} />
          {user && (
            <Box sx={{ display: "flex", gap: 1 }}>
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
                הווידאו שלי
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
                  sx={{ ml: 2, fontWeight: "bold" }}
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
