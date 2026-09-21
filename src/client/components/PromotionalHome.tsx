import { Box, Button, Container, Typography, Stack, Card, CardContent, Paper } from "@mui/material";
import { Subtitles, Language, Download, Login } from "@mui/icons-material";

interface PromotionalHomeProps {
  authLoading: boolean;
  onSignIn: () => Promise<void>;
}

export function PromotionalHome({ authLoading, onSignIn }: PromotionalHomeProps) {
  return (
    <Container maxWidth="lg">
      <Box sx={{ py: { xs: 8, md: 12 }, textAlign: "center" }}>
        <Stack spacing={6}>
          <Stack spacing={4} alignItems="center">
            <Typography
              variant="h2"
              component="h1"
              sx={{
                fontSize: { xs: "2.5rem", md: "3.5rem" },
                fontWeight: 700,
                color: "primary.main",
                mb: 2
              }}
            >
              כתוביות בעברית בקלות
            </Typography>

            <Typography
              variant="h5"
              sx={{
                color: "text.secondary",
                maxWidth: "600px",
                fontSize: { xs: "1.2rem", md: "1.5rem" },
                lineHeight: 1.4
              }}
            >
              יצירת כתוביות מדויקות בעברית לסרטונים שלכם בלחיצת כפתור.
              טכנולוגיית AI מתקדמת עם עריכה פשוטה ויעילה.
            </Typography>

            <Paper
              elevation={2}
              sx={{
                p: 4,
                mt: 4,
                bgcolor: "background.paper",
                border: "1px solid",
                borderColor: "divider"
              }}
            >
              <Typography variant="h6" gutterBottom color="text.primary">
                התחברו כדי להמשיך
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                נדרשת הרשמה פשוטה כדי לשמור ולנהל את הסרטונים שלכם
              </Typography>
              <Button
                variant="contained"
                onClick={onSignIn}
                disabled={authLoading}
                startIcon={<Login />}
                sx={{
                  fontSize: "1.1rem",
                  py: 1.5,
                  px: 4,
                  borderRadius: 3
                }}
              >
                {authLoading ? "מתחבר..." : "התחברות"}
              </Button>
            </Paper>
          </Stack>

          <Stack spacing={4} sx={{ mt: 8 }}>
            <Typography variant="h4" component="h2" sx={{ fontWeight: 600 }}>
              למה לבחור בנו?
            </Typography>

            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={4}
              justifyContent="center"
            >
              <Card sx={{ flex: 1, maxWidth: 300 }}>
                <CardContent sx={{ textAlign: "center", py: 4 }}>
                  <Subtitles sx={{ fontSize: 48, color: "primary.main", mb: 2 }} />
                  <Typography variant="h6" gutterBottom>
                    דיוק גבוה
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    טכנולוגיית AI מתקדמת עם דיוק מעל 95% עבור תוכן בעברית
                  </Typography>
                </CardContent>
              </Card>

              <Card sx={{ flex: 1, maxWidth: 300 }}>
                <CardContent sx={{ textAlign: "center", py: 4 }}>
                  <Language sx={{ fontSize: 48, color: "primary.main", mb: 2 }} />
                  <Typography variant="h6" gutterBottom>
                    תמיכה מלאה בעברית
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    מותאם במיוחד לשפה העברית עם הבנת הקשר ותרגום מדויק
                  </Typography>
                </CardContent>
              </Card>

              <Card sx={{ flex: 1, maxWidth: 300 }}>
                <CardContent sx={{ textAlign: "center", py: 4 }}>
                  <Download sx={{ fontSize: 48, color: "primary.main", mb: 2 }} />
                  <Typography variant="h6" gutterBottom>
                    פורמטים מגוונים
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    ייצוא ל-SRT, VTT, ושריפת כתוביות ישירות על הסרטון
                  </Typography>
                </CardContent>
              </Card>
            </Stack>
          </Stack>

          <Box sx={{ mt: 8, py: 6, bgcolor: "grey.50", borderRadius: 4 }}>
            <Typography variant="h5" gutterBottom sx={{ fontWeight: 600 }}>
              מוכנים להתחיל?
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
              העלו את הסרטון שלכם וקבלו כתוביות מושלמות תוך דקות ספורות
            </Typography>
            <Button
              variant="contained"
              size="large"
              onClick={onSignIn}
              disabled={authLoading}
              startIcon={<Login />}
              sx={{
                fontSize: "1.1rem",
                py: 1.5,
                px: 5,
                borderRadius: 3
              }}
            >
              {authLoading ? "מתחבר..." : "התחילו עכשיו - בחינם"}
            </Button>
          </Box>
        </Stack>
      </Box>
    </Container>
  );
}
