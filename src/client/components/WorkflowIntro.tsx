import { Stack, Typography } from "@mui/material";

export function WorkflowIntro() {
  return (
    <Stack spacing={1} textAlign="center" sx={{ display: { xs: "none", sm: "flex" } }}>
      <Typography variant="h4" component="h1">
        QuickCaption
      </Typography>
      <Typography variant="subtitle1" color="text.secondary">
        הפלטפורמה החכמה ליצירת כתוביות מתוזמנות ומוכנות לפרסום.
      </Typography>
    </Stack>
  );
}
