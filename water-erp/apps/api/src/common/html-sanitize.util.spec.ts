import { sanitizeHtmlContent } from './html-sanitize.util';

describe('sanitizeHtmlContent', () => {
  it('保留 seed 数据用到的安全标签 (h2/h3/p/strong)', () => {
    const input = '<h2>标题</h2><p>正文含 <strong>加粗</strong></p><h3>小节</h3>';
    expect(sanitizeHtmlContent(input)).toBe(input);
  });

  it('剥离 <script> 标签及其内容', () => {
    const result = sanitizeHtmlContent('<p>safe</p><script>alert("xss")</script>');
    expect(result).toContain('<p>safe</p>');
    expect(result).not.toContain('script');
    expect(result).not.toContain('alert');
  });

  it('剥离 on* 事件处理器属性', () => {
    const result = sanitizeHtmlContent(
      '<p onclick="steal()">text</p><img src="x" onerror="evil()">',
    );
    expect(result).toContain('text');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('evil');
    expect(result).not.toContain('steal');
  });

  it('剥离 javascript: 协议的 href', () => {
    const result = sanitizeHtmlContent('<a href="javascript:alert(1)">click</a>');
    expect(result).toContain('click');
    expect(result).not.toContain('javascript:');
  });

  it('剥离 iframe / object / embed', () => {
    const result = sanitizeHtmlContent(
      '<p>text</p><iframe src="evil"></iframe><object data="evil"></object><embed src="evil">',
    );
    expect(result).toContain('<p>text</p>');
    expect(result).not.toContain('iframe');
    expect(result).not.toContain('object');
    expect(result).not.toContain('embed');
    expect(result).not.toContain('evil');
  });

  it('保留 http/https 链接', () => {
    const result = sanitizeHtmlContent('<a href="https://example.com">link</a>');
    expect(result).toContain('href="https://example.com"');
  });

  it('保留 span/div 的 class 与 style', () => {
    const result = sanitizeHtmlContent('<span class="hl" style="color:red">t</span>');
    expect(result).toContain('class="hl"');
    expect(result).toContain('style="color:red"');
  });

  it('保留列表标签 (ul/ol/li)', () => {
    const input = '<ul><li>item1</li><li>item2</li></ul>';
    expect(sanitizeHtmlContent(input)).toBe(input);
  });

  it('保留表格标签', () => {
    const result = sanitizeHtmlContent(
      '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
    );
    expect(result).toContain('<table>');
    expect(result).toContain('<thead>');
    expect(result).toContain('<td>1</td>');
  });

  it('嵌套结构中的 script 仍被剥离', () => {
    const result = sanitizeHtmlContent('<div><script>alert(1)</script>safe</div>');
    expect(result).toContain('safe');
    expect(result).not.toContain('alert(1)');
  });

  it('空/null/undefined 入参透传', () => {
    expect(sanitizeHtmlContent('')).toBe('');
    expect(sanitizeHtmlContent(null as unknown as string)).toBeNull();
    expect(sanitizeHtmlContent(undefined as unknown as string)).toBeUndefined();
  });
});
