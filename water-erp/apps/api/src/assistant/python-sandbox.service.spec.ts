import { Test, TestingModule } from '@nestjs/testing';
import { PythonSandboxService } from './python-sandbox.service';

describe('PythonSandboxService', () => {
  let service: PythonSandboxService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PythonSandboxService],
    }).compile();
    service = module.get<PythonSandboxService>(PythonSandboxService);
    // onModuleInit will run; chartEnabled depends on whether python3 is available
  });

  describe('validateCode', () => {
    it('should accept safe matplotlib code', () => {
      const code = `
import matplotlib.pyplot as plt
import numpy as np
x = [1,2,3]
plt.bar(x, x)
plt.savefig('output.png')
`;
      const result = (service as any).validateCode(code);
      expect(result.valid).toBe(true);
    });

    it('should reject os import', () => {
      const code = `import os\nos.system('ls')`;
      const result = (service as any).validateCode(code);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('os');
    });

    it('should reject eval() call', () => {
      const code = `eval('print(1)')`;
      const result = (service as any).validateCode(code);
      expect(result.valid).toBe(false);
    });

    it('should reject subprocess import', () => {
      const code = `import subprocess\nsubprocess.run(['ls'])`;
      const result = (service as any).validateCode(code);
      expect(result.valid).toBe(false);
    });

    it('should reject __builtins__ access', () => {
      const code = `print(__builtins__)`;
      const result = (service as any).validateCode(code);
      expect(result.valid).toBe(false);
    });
  });

  describe('prepareCode', () => {
    it('should inject data and font setup before user code', () => {
      const userCode = `plt.bar(data['labels'], data['values'])`;
      const testData = { labels: ['A', 'B'], values: [10, 20] };
      const prepared = (service as any).prepareCode(userCode, testData);
      expect(prepared).toContain('data = json.loads');
      expect(prepared).toContain('"labels"');
      expect(prepared).toContain('matplotlib.use');
      expect(prepared).toContain('font.family');
      expect(prepared).toContain(userCode);
    });
  });
});
