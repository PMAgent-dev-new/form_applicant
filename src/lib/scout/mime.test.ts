import { describe, expect, it } from 'vitest';
import { buildMimeMessage } from '@/lib/email/gmail-client';
const message={from:'sender@example.com',to:'sample@example.com',subject:'お仕事のご案内',textBody:'本文',htmlBody:'<p>本文</p>'};
describe('scout MIME headers',()=>{
  it('encodes reply address and the one-click unsubscribe header without CC/BCC',()=>{
    const raw=Buffer.from(buildMimeMessage({...message,replyTo:'reply@example.com',unsubscribeUrl:'https://ridejob.jp/entry/api/scout/unsubscribe?token=example'}),'base64url').toString();
    expect(raw).toContain('Reply-To: reply@example.com\r\n');
    expect(raw).toContain('List-Unsubscribe: <https://ridejob.jp/entry/api/scout/unsubscribe?token=example>\r\n');
    expect(raw).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n');
    expect(raw).not.toMatch(/\r\n(?:Cc|Bcc):/);
  });
  it('rejects injected header lines and non-HTTPS stop links',()=>{
    expect(()=>buildMimeMessage({...message,replyTo:'reply@example.com\r\nBcc: other@example.com'})).toThrow();
    expect(()=>buildMimeMessage({...message,subject:'件名\n別ヘッダー'})).toThrow();
    expect(()=>buildMimeMessage({...message,unsubscribeUrl:'http://example.com/stop'})).toThrow();
  });
});
