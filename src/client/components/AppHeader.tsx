import type { MouseEvent } from "react";
import {
  AppBar,
  Avatar,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
} from "@mui/material";
import type { AuthUser } from "../hooks/useTranscriptionWorkflow";

type AppHeaderProps = {
  user: AuthUser;
  authLoading: boolean;
  profileAnchorEl: HTMLElement | null;
  onProfileClick: (event: MouseEvent<HTMLElement>) => void;
  onProfileClose: () => void;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
};

export function AppHeader({
  user,
  authLoading,
  profileAnchorEl,
  onProfileClick,
  onProfileClose,
  onSignIn,
  onSignOut,
}: AppHeaderProps) {
  return (
    <AppBar position="fixed" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
      <Toolbar>
        <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center" }}>
          <Box component="img" src="/quickcaption-logo.svg" alt="QuickCaption" sx={{ height: 32 }} />
        </Box>
        {user ? (
          <>
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
