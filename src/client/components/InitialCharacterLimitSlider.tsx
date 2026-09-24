import { Box, Slider, Stack, Typography } from "@mui/material";

type InitialCharacterLimitSliderProps = {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
};

export function InitialCharacterLimitSlider({ value, onChange, disabled = false }: InitialCharacterLimitSliderProps) {
  return (
    <Stack spacing={0.25} sx={{ px: { xs: 1.5, sm: 2 }, pt: { xs: 0.75, sm: 1.5 }, pb: 1.5, borderRadius: 2, bgcolor: "action.hover" }}>
      <Typography variant="subtitle2" fontWeight={700}>אורך הכתובית</Typography>
      <Typography variant="body2" color="text.secondary">עד {value} תווים בכתובית, כולל רווחים</Typography>
      <Box dir="rtl" sx={{ px: 1.5, pb: 1.5 }}>
        <Slider
          aria-label="מספר תווים בכתובית לפני תמלול"
          value={value}
          onChange={(_, next) => onChange(next as number)}
          min={7}
          max={20}
          step={1}
          marks={[{ value: 7, label: "7" }, { value: 20, label: "20" }]}
          valueLabelDisplay="auto"
          disabled={disabled}
          sx={{ display: "block", mb: 1, "& .MuiSlider-markLabel": { top: 30 } }}
        />
      </Box>
    </Stack>
  );
}
