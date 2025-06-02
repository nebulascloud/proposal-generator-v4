// flow-session-status.test.js
process.env.NODE_ENV = 'test';
const sessionId = 'test-session-id-' + Date.now();

describe('flowAgent session status update', () => {
  test('properly updates session status on completion and failure', async () => {
    jest.resetModules();
    const mockSession = {
      create: jest.fn().mockResolvedValue({
        id: sessionId,
        proposal_id: 'test-proposal',
        status: 'active',
        created_at: new Date().toISOString()
      }),
      update: jest.fn().mockImplementation(async (data) => {
        const { id, status, completedAt, failedAt, metadata } = data;
        return {
          id,
          status,
          completed_at: completedAt,
          failed_at: failedAt,
          updated_at: new Date().toISOString(),
          metadata: metadata || {}
        };
      }),
      getById: jest.fn().mockResolvedValue({
        id: sessionId,
        metadata: {}
      })
    };
    const sessionPath = require.resolve('../db/models/session');
    jest.doMock(sessionPath, () => mockSession);
    await jest.isolateModulesAsync(async () => {
      const flowModule = require('../agents/flowAgent');
      // 1. Test successful completion
      const mockResult = {
        flowData: { proposalId: 'test-success-proposal' },
        summary: { status: 'completed' }
      };
      await flowModule.handleCompletedFlow(sessionId, mockResult);
      expect(mockSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: sessionId,
          status: 'completed',
          completedAt: expect.any(Date),
        })
      );
      mockSession.update.mockClear();
      // 2. Test failure handling
      const mockError = new Error('Test flow error');
      const mockErrorFiles = ['/uploads/mock-proposal-id/mock_file.txt'];
      await flowModule.handleFlowError(sessionId, mockError, mockErrorFiles);
      expect(mockSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: sessionId,
          status: 'failed',
          failedAt: expect.any(Date),
        })
      );
    });
  });
});
