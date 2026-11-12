import type { Express } from 'express';
import { ProjectManagementController } from './project-management.controller';

describe('ProjectManagementController', () => {
  it('passes the uploaded initiation pdf directly to the service without requiring json extraction fields', async () => {
    const extractInitiationFromUploadedFile = jest.fn().mockResolvedValue({
      fields: { requesterName: '张三' },
      attachment: { fileName: '采购立项申请表.pdf' },
      extractedText: 'mock text',
    });

    const controller = new ProjectManagementController({
      list: jest.fn(),
      createFromInitiation: jest.fn(),
      extractInitiationFieldsFromText: jest.fn(),
      extractInitiationFromUploadedFile,
      updateStage: jest.fn(),
      addStageAttachment: jest.fn(),
      moveToRecycleBin: jest.fn(),
      restoreFromRecycleBin: jest.fn(),
      deletePermanently: jest.fn(),
      completeProject: jest.fn(),
      analyzeProject: jest.fn(),
    } as never, { stampFor: jest.fn().mockResolvedValue({}), resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}) } as never, { register: jest.fn(), list: jest.fn(), bindAnnouncement: jest.fn() } as never,
      { getTimeline: jest.fn() } as never,
      {} as never); // TenderDraftService——本 spec 未覆盖草稿端点，占位即可

    const file = {
      originalname: '采购立项申请表.pdf',
      mimetype: 'application/pdf',
      size: 1024,
      buffer: Buffer.from('mock'),
    } as Express.Multer.File;

    await expect(
      controller.extractInitiation(file, {
        sub: 'user-01',
        username: 'Swhi-CGZX-admin',
        role: 'admin',
      }),
    ).resolves.toMatchObject({
      fields: { requesterName: '张三' },
    });

    expect(extractInitiationFromUploadedFile).toHaveBeenCalledWith(
      file,
      'user-01',
    );
  });

  it('forwards project removal to the service（2026-11-12 §9：移除=直删留痕唯一路径）', async () => {
    const deletePermanently = jest.fn().mockResolvedValue({ success: true });

    const controller = new ProjectManagementController({
      list: jest.fn(),
      createFromInitiation: jest.fn(),
      extractInitiationFieldsFromText: jest.fn(),
      extractInitiationFromUploadedFile: jest.fn(),
      updateStage: jest.fn(),
      addStageAttachment: jest.fn(),
      deletePermanently,
      completeProject: jest.fn(),
      analyzeProject: jest.fn(),
    } as never, { stampFor: jest.fn().mockResolvedValue({}), resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}) } as never, { register: jest.fn(), list: jest.fn(), bindAnnouncement: jest.fn() } as never,
      { getTimeline: jest.fn() } as never,
      {} as never); // TenderDraftService——本 spec 未覆盖草稿端点，占位即可

    await expect(controller.deletePermanently('pm-01', undefined)).resolves.toEqual({
      success: true,
    });

    expect(deletePermanently).toHaveBeenCalledWith('pm-01', undefined);
  });

  it('forwards project analysis requests with an optional stage key to the service', async () => {
    const analyzeProject = jest.fn().mockResolvedValue({
      summary: {
        stageMatch: '项目当前推进至专家抽取阶段。',
        contentSummary: '项目围绕科研平台采购展开，当前处于中段推进。',
      },
      fileAnalyses: [],
    });

    const controller = new ProjectManagementController({
      list: jest.fn(),
      createFromInitiation: jest.fn(),
      extractInitiationFieldsFromText: jest.fn(),
      extractInitiationFromUploadedFile: jest.fn(),
      updateStage: jest.fn(),
      addStageAttachment: jest.fn(),
      moveToRecycleBin: jest.fn(),
      restoreFromRecycleBin: jest.fn(),
      deletePermanently: jest.fn(),
      completeProject: jest.fn(),
      analyzeProject,
    } as never, { stampFor: jest.fn().mockResolvedValue({}), resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}) } as never, { register: jest.fn(), list: jest.fn(), bindAnnouncement: jest.fn() } as never,
      { getTimeline: jest.fn() } as never,
      {} as never); // TenderDraftService——本 spec 未覆盖草稿端点，占位即可

    await expect(
      controller.analyzeProject('pm-01', 'EXPERT_SELECTION'),
    ).resolves.toEqual({
      summary: {
        stageMatch: '项目当前推进至专家抽取阶段。',
        contentSummary: '项目围绕科研平台采购展开，当前处于中段推进。',
      },
      fileAnalyses: [],
    });

    expect(analyzeProject).toHaveBeenCalledWith('pm-01', 'EXPERT_SELECTION', false);
  });
});
