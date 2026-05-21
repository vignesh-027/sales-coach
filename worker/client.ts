// Alias env names from .env.local to the names the Trigger.dev SDK reads.
// Must run before importing the SDK.
if (!process.env.TRIGGER_SECRET_KEY && process.env.Trigger_Secret_key) {
  process.env.TRIGGER_SECRET_KEY = process.env.Trigger_Secret_key;
}
if (!process.env.TRIGGER_PROJECT_ID && process.env.Trigger_Project_ID) {
  process.env.TRIGGER_PROJECT_ID = process.env.Trigger_Project_ID;
}

export { task, tasks, retry, wait } from "@trigger.dev/sdk";
export const TRIGGER_PROJECT_ID = process.env.TRIGGER_PROJECT_ID;
export const TRIGGER_SECRET_KEY = process.env.TRIGGER_SECRET_KEY;
