import { client } from '@devrev/typescript-sdk';
import { handleEvent } from '.';
import { testRunner } from '../../test-runner/test-runner';

jest.mock('@devrev/typescript-sdk', () => ({
  client: {
    setup: jest.fn(),
  },
  publicSDK: {
    WorkType: {
      Ticket: 'ticket',
    },
    TimelineEntriesCreateRequestType: {
      TimelineComment: 'timeline_comment',
    },
    TimelineEntryVisibility: {
      Public: 'public',
    },
  },
}));

describe('Example Index Test file', () => {
  it('Testing handleEvent', async () => {
    const mockSetup = jest.fn();
    client.setup = mockSetup;
    const mockTimelineEntriesCreate = jest.fn();
    mockSetup.mockReturnValue({
      timelineEntriesCreate: mockTimelineEntriesCreate,
    });
    mockTimelineEntriesCreate.mockReturnValue({
      timeline_entry: {
        id: 'timeline-123',
      },
    });
    const event = {
      payload: {
        work_created: {
          work: {
            id: '123',
          },
        },
      },
      context: {
        secrets: {
          service_account_token: 'TEST-PAT',
        },
      },
      input_data: {
        global_values: {
          greeting: 'Hello World!',
        },
      },
      execution_metadata: {
        devrev_endpoint: 'https://api.devrev.ai',
      },
    };
    const expectedResp = {
      timeline_entry: {
        id: 'timeline-123',
      },
    };
    const response = await handleEvent(event);
    expect(response).toEqual(expectedResp);
  });
});

describe('Example Index Test file', () => {
  it('Testing the method', () => {
    testRunner({
      fixturePath: 'on_work_created_event.json',
      functionName: 'on_work_creation',
    });
  });
});
