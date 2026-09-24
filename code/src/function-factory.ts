import handle_teams_message from './functions/handle_teams_message';
import handle_agent_response from './functions/handle_agent_response';

export const functionFactory = {
  handle_teams_message,
  handle_agent_response,
} as const;

export type FunctionFactoryType = keyof typeof functionFactory;
