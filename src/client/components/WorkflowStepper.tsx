import { Step, StepLabel, Stepper } from "@mui/material";

type WorkflowStepperProps = {
  steps: string[];
  activeStep: number;
};

export function WorkflowStepper({ steps, activeStep }: WorkflowStepperProps) {
  return (
    <Stepper activeStep={activeStep} alternativeLabel>
      {steps.map((label) => (
        <Step key={label}>
          <StepLabel>{label}</StepLabel>
        </Step>
      ))}
    </Stepper>
  );
}
