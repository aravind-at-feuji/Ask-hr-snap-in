import { client, publicSDK } from "@devrev/typescript-sdk";

export async function handleEvent(
  event: any,
) {
  const devrevPAT = event.context.secrets.service_account_token;
  const APIBase = event.execution_metadata.devrev_endpoint;
  const devrevSDK = client.setup({
    endpoint: APIBase,
    token: devrevPAT,
  })
  try {
    // Get the work id from the event payload.
    const workId = event.payload.work_created.work.id;

    // Get the greeting message from the input data.
    const message = event.input_data.global_values.greeting;

    // Create a timeline entry for the work.
    const timelineRequest : publicSDK.TimelineEntriesCreateRequest = {
      object: workId,
      type: publicSDK.TimelineEntriesCreateRequestType.TimelineComment,
      visibility: publicSDK.TimelineEntryVisibility.Public,
      private_to: [],
      body: message,
    };

    // Create the timeline entry.
    const response = await devrevSDK.timelineEntriesCreate(timelineRequest);

    // Log success.
    console.log(`Timeline entry created for work ${workId}`);
    return response;
  } catch (error) {
    console.log(error);
    return error;
  }
}

export const run = async (events: any[]) => {
  /*
  Put your code here to handle the event.
  */
  for (let event of events) {
    await handleEvent(event);
  }
};

export default run;
