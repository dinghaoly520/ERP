import { Workbook } from 'exceljs';
import { normalizeCatalogImportRow, parseBoolean } from './catalog-import';

describe('catalog import helpers', () => {
  it.each([
    ['是', true],
    ['否', false],
    ['1', true],
    ['0', false],
  ])('parses boolean value %s', (input, expected) => {
    expect(parseBoolean(input)).toBe(expected);
  });

  it('normalizes a valid Chinese-header row', () => {
    const result = normalizeCatalogImportRow(2, {
      目录编码: 'CAT-001',
      名称: '测试物资',
      规格型号: 'DN100',
      分类: '管材',
      分组: 'A组',
      单位: '米',
      参考价: '120.5',
      供应商: '四川供应商',
      价格来源: '最近成交',
      区域: '成都',
      含税: '是',
      含运费: '否',
    });

    expect(result.errors).toEqual([]);
    expect(result.data).toEqual(
      expect.objectContaining({
        code: 'CAT-001',
        referencePrice: 120.5,
        taxIncluded: true,
        freightIncluded: false,
        status: '有效',
      }),
    );
  });

  it('reports invalid reference price range', () => {
    const result = normalizeCatalogImportRow(2, {
      code: 'CAT-001',
      name: '测试物资',
      specification: 'DN100',
      category: '管材',
      group: 'A组',
      unit: '米',
      referencePrice: 200,
      priceMin: 250,
      priceMax: 300,
      supplier: '四川供应商',
      priceSource: '最近成交',
      region: '成都',
    });

    expect(result.data).toBeUndefined();
    expect(result.errors).toContain('参考价必须位于价格下限和价格上限之间');
  });
});
