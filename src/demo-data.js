/**
 * Demo Data Generator
 * Creates 300+ mock plaintext cipher items for demo mode
 * Includes: exact duplicates, same-site duplicates, orphans, weak/empty passwords
 */

const DEMO_FOLDERS_I18N = {
  'folder-social': { zh: '社交媒体', en: 'Social Media' },
  'folder-finance': { zh: '金融理财', en: 'Finance' },
  'folder-shopping': { zh: '购物网站', en: 'Shopping' },
  'folder-work': { zh: '工作相关', en: 'Work' },
  'folder-dev': { zh: '开发工具', en: 'Dev Tools' },
  'folder-gaming': { zh: '游戏娱乐', en: 'Gaming' },
  'folder-email': { zh: '邮箱', en: 'Email' },
  'folder-cloud': { zh: '云服务', en: 'Cloud' },
};

function getDemoFolders(locale) {
  return Object.entries(DEMO_FOLDERS_I18N).map(([id, names]) => ({
    id,
    name: names[locale] || names.zh,
  }));
}

// Sites with bilingual names (Chinese-specific items have en alternatives)
const SITES = [
  { name: 'GitHub', url: 'https://github.com', folder: 'folder-dev' },
  { name: 'GitLab', url: 'https://gitlab.com', folder: 'folder-dev' },
  { name: 'Bitbucket', url: 'https://bitbucket.org', folder: 'folder-dev' },
  { name: 'Stack Overflow', url: 'https://stackoverflow.com', folder: 'folder-dev' },
  { name: 'NPM', url: 'https://npmjs.com', folder: 'folder-dev' },
  { name: 'Docker Hub', url: 'https://hub.docker.com', folder: 'folder-dev' },
  { name: 'Vercel', url: 'https://vercel.com', folder: 'folder-dev' },
  { name: 'Netlify', url: 'https://netlify.com', folder: 'folder-dev' },
  { name: 'Cloudflare', url: 'https://dash.cloudflare.com', folder: 'folder-dev' },
  { name: 'AWS Console', url: 'https://console.aws.amazon.com', folder: 'folder-cloud' },
  { name: 'Google Cloud', url: 'https://console.cloud.google.com', folder: 'folder-cloud' },
  { name: 'Azure Portal', url: 'https://portal.azure.com', folder: 'folder-cloud' },
  { name: 'DigitalOcean', url: 'https://cloud.digitalocean.com', folder: 'folder-cloud' },
  { name: 'Supabase', url: 'https://supabase.com', folder: 'folder-dev' },
  { name: 'Firebase', url: 'https://console.firebase.google.com', folder: 'folder-dev' },
  { zh: '微信', en: 'WeChat', url: 'https://weixin.qq.com', folder: 'folder-social' },
  { zh: '微博', en: 'Weibo', url: 'https://weibo.com', folder: 'folder-social' },
  { zh: '知乎', en: 'Zhihu', url: 'https://zhihu.com', folder: 'folder-social' },
  { zh: '豆瓣', en: 'Douban', url: 'https://douban.com', folder: 'folder-social' },
  { zh: '哔哩哔哩', en: 'Bilibili', url: 'https://bilibili.com', folder: 'folder-social' },
  { zh: '抖音', en: 'Douyin', url: 'https://douyin.com', folder: 'folder-social' },
  { name: 'Twitter / X', url: 'https://x.com', folder: 'folder-social' },
  { name: 'Facebook', url: 'https://facebook.com', folder: 'folder-social' },
  { name: 'Instagram', url: 'https://instagram.com', folder: 'folder-social' },
  { name: 'Reddit', url: 'https://reddit.com', folder: 'folder-social' },
  { name: 'Discord', url: 'https://discord.com', folder: 'folder-social' },
  { name: 'Telegram', url: 'https://web.telegram.org', folder: 'folder-social' },
  { name: 'LinkedIn', url: 'https://linkedin.com', folder: 'folder-work' },
  { name: 'Slack', url: 'https://slack.com', folder: 'folder-work' },
  { name: 'Notion', url: 'https://notion.so', folder: 'folder-work' },
  { name: 'Trello', url: 'https://trello.com', folder: 'folder-work' },
  { name: 'Jira', url: 'https://jira.atlassian.com', folder: 'folder-work' },
  { name: 'Figma', url: 'https://figma.com', folder: 'folder-work' },
  { name: 'Canva', url: 'https://canva.com', folder: 'folder-work' },
  { name: 'Zoom', url: 'https://zoom.us', folder: 'folder-work' },
  { zh: '淘宝', en: 'Taobao', url: 'https://taobao.com', folder: 'folder-shopping' },
  { zh: '京东', en: 'JD.com', url: 'https://jd.com', folder: 'folder-shopping' },
  { zh: '拼多多', en: 'Pinduoduo', url: 'https://pinduoduo.com', folder: 'folder-shopping' },
  { name: 'Amazon', url: 'https://amazon.com', folder: 'folder-shopping' },
  { name: 'eBay', url: 'https://ebay.com', folder: 'folder-shopping' },
  { name: 'Apple Store', url: 'https://store.apple.com', folder: 'folder-shopping' },
  { zh: '支付宝', en: 'Alipay', url: 'https://alipay.com', folder: 'folder-finance' },
  { zh: '招商银行', en: 'CMB Bank', url: 'https://cmbchina.com', folder: 'folder-finance' },
  { zh: '工商银行', en: 'ICBC Bank', url: 'https://icbc.com.cn', folder: 'folder-finance' },
  { name: 'PayPal', url: 'https://paypal.com', folder: 'folder-finance' },
  { name: 'Stripe', url: 'https://dashboard.stripe.com', folder: 'folder-finance' },
  { name: 'Coinbase', url: 'https://coinbase.com', folder: 'folder-finance' },
  { name: 'Binance', url: 'https://binance.com', folder: 'folder-finance' },
  { name: 'Steam', url: 'https://store.steampowered.com', folder: 'folder-gaming' },
  { name: 'Epic Games', url: 'https://epicgames.com', folder: 'folder-gaming' },
  { name: 'PlayStation', url: 'https://playstation.com', folder: 'folder-gaming' },
  { name: 'Xbox', url: 'https://xbox.com', folder: 'folder-gaming' },
  { name: 'Nintendo', url: 'https://nintendo.com', folder: 'folder-gaming' },
  { name: 'Spotify', url: 'https://spotify.com', folder: 'folder-gaming' },
  { name: 'Netflix', url: 'https://netflix.com', folder: 'folder-gaming' },
  { name: 'YouTube', url: 'https://youtube.com', folder: 'folder-social' },
  { name: 'Gmail', url: 'https://mail.google.com', folder: 'folder-email' },
  { name: 'Outlook', url: 'https://outlook.live.com', folder: 'folder-email' },
  { zh: 'QQ邮箱', en: 'QQ Mail', url: 'https://mail.qq.com', folder: 'folder-email' },
  { zh: '163邮箱', en: '163 Mail', url: 'https://mail.163.com', folder: 'folder-email' },
  { name: 'ProtonMail', url: 'https://mail.proton.me', folder: 'folder-email' },
  { name: 'iCloud', url: 'https://icloud.com', folder: 'folder-cloud' },
  { name: 'Dropbox', url: 'https://dropbox.com', folder: 'folder-cloud' },
  { name: 'Google Drive', url: 'https://drive.google.com', folder: 'folder-cloud' },
  { name: 'OneDrive', url: 'https://onedrive.live.com', folder: 'folder-cloud' },
];

function getSiteName(site, locale) {
  if (site.name) return site.name;
  return site[locale] || site.zh;
}

const EMAILS = [
  'demo@example.com',
  'user123@gmail.com',
  'admin@company.cn',
  'test.user@outlook.com',
  'frank@xuebz.com',
];

function randomId() {
  return crypto.randomUUID ? crypto.randomUUID() : 
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function randomPassword(length = 16) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let pw = '';
  for (let i = 0; i < length; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

function weakPassword() {
  const weak = ['123456', 'password', 'qwerty', 'abc123', '111111', 'admin', 'letmein', 'welcome'];
  return weak[Math.floor(Math.random() * weak.length)];
}

function randomDate(daysAgo = 365) {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysAgo));
  return d.toISOString();
}

function oldDate() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 2);
  d.setDate(d.getDate() - Math.floor(Math.random() * 365));
  return d.toISOString();
}

function makeCipher({ name, url, username, password, folderId, totp, notes, fields, favorite, creationDate, revisionDate }) {
  const id = randomId();
  const created = creationDate || randomDate();
  const revised = revisionDate || created;
  const raw = {
    Id: id,
    Type: 1, // Login
    Name: name,
    Notes: notes || null,
    FolderId: folderId || null,
    Favorite: favorite || false,
    Reprompt: 0,
    Login: {
      Username: username || '',
      Password: password || '',
      Uris: url ? [{ Uri: url, Match: null }] : [],
      Totp: totp || null,
      Fido2Credentials: [],
    },
    Fields: fields || null,
    CreationDate: created,
    RevisionDate: revised,
    DeletedDate: null,
    _original: null, // will be set below
  };
  raw._original = JSON.parse(JSON.stringify(raw));
  return {
    id,
    type: 1,
    raw,
    decrypted: {
      name,
      username: username || '',
      password: password || '',
      uri: url || '',
      notes: notes || '',
      totp: totp || '',
      fields: (fields || []).map(f => ({
        name: f.Name,
        value: f.Value,
        type: f.Type,
      })),
    },
  };
}

export function generateDemoData(locale = 'zh') {
  const DEMO_FOLDERS = getDemoFolders(locale);
  const ciphers = [];
  const usedSites = [...SITES];

  // === 1) Normal items (~220) ===
  for (const site of usedSites) {
    const email = EMAILS[Math.floor(Math.random() * EMAILS.length)];
    ciphers.push(makeCipher({
      name: getSiteName(site, locale),
      url: site.url,
      username: email,
      password: randomPassword(),
      folderId: site.folder,
      creationDate: randomDate(300),
    }));
  }

  // Extra items to reach ~220+
  const extraSites = [
    { name: 'ChatGPT', url: 'https://chat.openai.com' },
    { name: 'Claude', url: 'https://claude.ai' },
    { name: 'Gemini', url: 'https://gemini.google.com' },
    { name: 'V2EX', url: 'https://v2ex.com' },
    { name: 'SegmentFault', url: 'https://segmentfault.com' },
    { name: 'CSDN', url: 'https://csdn.net' },
    { zh: '掘金', en: 'Juejin', url: 'https://juejin.cn' },
    { name: 'LeetCode', url: 'https://leetcode.com' },
    { name: 'Coursera', url: 'https://coursera.org' },
    { name: 'Udemy', url: 'https://udemy.com' },
    { name: 'Medium', url: 'https://medium.com' },
    { name: 'DEV Community', url: 'https://dev.to' },
    { name: 'Hacker News', url: 'https://news.ycombinator.com' },
    { name: 'Product Hunt', url: 'https://producthunt.com' },
    { name: 'Dribbble', url: 'https://dribbble.com' },
    { name: 'Behance', url: 'https://behance.net' },
    { name: 'Pinterest', url: 'https://pinterest.com' },
    { name: 'TikTok', url: 'https://tiktok.com' },
    { name: 'Twitch', url: 'https://twitch.tv' },
    { name: '小红书', url: 'https://xiaohongshu.com' },
    { name: '百度网盘', url: 'https://pan.baidu.com' },
    { name: '百度', url: 'https://baidu.com' },
    { name: '快手', url: 'https://kuaishou.com' },
    { name: '美团', url: 'https://meituan.com' },
    { name: '饿了么', url: 'https://ele.me' },
    { name: '携程', url: 'https://ctrip.com' },
    { name: 'Airbnb', url: 'https://airbnb.com' },
    { name: 'Booking.com', url: 'https://booking.com' },
    { name: 'Uber', url: 'https://uber.com' },
    { name: '滴滴', url: 'https://didiglobal.com' },
    { name: 'Grammarly', url: 'https://grammarly.com' },
    { name: '1Password', url: 'https://my.1password.com' },
    { name: 'LastPass', url: 'https://lastpass.com' },
    { name: 'Bitwarden', url: 'https://vault.bitwarden.com' },
    { name: 'Namecheap', url: 'https://namecheap.com' },
    { name: 'GoDaddy', url: 'https://godaddy.com' },
    { name: 'Cloudflare Registrar', url: 'https://dash.cloudflare.com/registrar' },
    { name: 'MongoDB Atlas', url: 'https://cloud.mongodb.com' },
    { name: 'PlanetScale', url: 'https://planetscale.com' },
    { name: 'Railway', url: 'https://railway.app' },
    { name: 'Render', url: 'https://render.com' },
    { name: 'Fly.io', url: 'https://fly.io' },
    { name: 'Heroku', url: 'https://heroku.com' },
    { name: 'Sentry', url: 'https://sentry.io' },
    { name: 'Datadog', url: 'https://datadoghq.com' },
    { name: 'New Relic', url: 'https://newrelic.com' },
    { name: 'Grafana', url: 'https://grafana.com' },
    { name: 'Postman', url: 'https://postman.com' },
    { name: 'Insomnia', url: 'https://insomnia.rest' },
    { name: 'CodeSandbox', url: 'https://codesandbox.io' },
    { name: 'StackBlitz', url: 'https://stackblitz.com' },
    { name: 'Replit', url: 'https://replit.com' },
    { name: 'Codepen', url: 'https://codepen.io' },
    { name: 'JSFiddle', url: 'https://jsfiddle.net' },
    { name: 'WordPress', url: 'https://wordpress.com' },
    { name: 'Squarespace', url: 'https://squarespace.com' },
    { name: 'Wix', url: 'https://wix.com' },
    { name: 'Shopify', url: 'https://shopify.com' },
    { name: 'Gumroad', url: 'https://gumroad.com' },
    { name: 'Patreon', url: 'https://patreon.com' },
    { name: 'Buy Me a Coffee', url: 'https://buymeacoffee.com' },
    { name: '台北101观景台', url: 'https://www.taipei-101.com.tw' },
    { name: '故宫博物院', url: 'https://www.npm.gov.tw' },
    { name: '日本航空', url: 'https://www.jal.co.jp' },
    { name: '全日空', url: 'https://www.ana.co.jp' },
    { name: 'TradingView', url: 'https://tradingview.com' },
    { name: 'Interactive Brokers', url: 'https://interactivebrokers.com' },
    { name: '富途牛牛', url: 'https://www.futunn.com' },
    { name: '东方财富', url: 'https://www.eastmoney.com' },
    { name: '同花顺', url: 'https://www.10jqka.com.cn' },
    // Batch 2 — more real-world sites
    { name: 'Notion Calendar', url: 'https://calendar.notion.so' },
    { name: 'Linear', url: 'https://linear.app' },
    { name: 'Asana', url: 'https://asana.com' },
    { name: 'Monday.com', url: 'https://monday.com' },
    { name: 'Airtable', url: 'https://airtable.com' },
    { name: 'Miro', url: 'https://miro.com' },
    { name: 'Loom', url: 'https://loom.com' },
    { name: 'Calendly', url: 'https://calendly.com' },
    { name: 'HubSpot', url: 'https://hubspot.com' },
    { name: 'Mailchimp', url: 'https://mailchimp.com' },
    { name: 'SendGrid', url: 'https://sendgrid.com' },
    { name: 'Twilio', url: 'https://twilio.com' },
    { name: 'Algolia', url: 'https://algolia.com' },
    { name: 'Auth0', url: 'https://auth0.com' },
    { name: 'Okta', url: 'https://okta.com' },
    { name: 'Hashicorp Vault', url: 'https://vault.hashicorp.com' },
    { name: 'Terraform Cloud', url: 'https://app.terraform.io' },
    { name: 'CircleCI', url: 'https://circleci.com' },
    { name: 'Travis CI', url: 'https://travis-ci.com' },
    { name: 'Jenkins', url: 'https://jenkins.io' },
    { name: 'Sonarqube', url: 'https://sonarcloud.io' },
    { name: 'Snyk', url: 'https://snyk.io' },
    { name: 'Dependabot', url: 'https://github.com/dependabot' },
    { name: 'Crowdin', url: 'https://crowdin.com' },
    { name: 'Lokalise', url: 'https://lokalise.com' },
    { name: 'Weblate', url: 'https://weblate.org' },
    { name: 'DeepL', url: 'https://deepl.com' },
    { name: 'OpenAI Platform', url: 'https://platform.openai.com' },
    { name: 'Anthropic Console', url: 'https://console.anthropic.com' },
    { name: 'Hugging Face', url: 'https://huggingface.co' },
    { name: 'Kaggle', url: 'https://kaggle.com' },
    { name: 'Weights & Biases', url: 'https://wandb.ai' },
    { name: 'Vercel Analytics', url: 'https://vercel.com/analytics' },
    { name: 'Plausible', url: 'https://plausible.io' },
    { name: 'Umami', url: 'https://umami.is' },
    { name: 'Upstash', url: 'https://upstash.com' },
    { name: 'Neon', url: 'https://neon.tech' },
    { name: 'CockroachDB', url: 'https://cockroachlabs.cloud' },
    { name: 'Turso', url: 'https://turso.tech' },
    { name: 'Deno Deploy', url: 'https://dash.deno.com' },
    { name: 'Bun', url: 'https://bun.sh' },
    { name: 'JSR', url: 'https://jsr.io' },
    { name: 'npm Registry', url: 'https://registry.npmjs.org' },
    { name: 'PyPI', url: 'https://pypi.org' },
    { name: 'RubyGems', url: 'https://rubygems.org' },
    { name: 'Crates.io', url: 'https://crates.io' },
    { name: 'Go Modules', url: 'https://pkg.go.dev' },
    { name: 'NuGet', url: 'https://nuget.org' },
    { name: 'Maven Central', url: 'https://central.sonatype.com' },
    { name: 'Homebrew', url: 'https://brew.sh' },
    { name: 'Docker Registry', url: 'https://registry.hub.docker.com' },
    { name: 'Quay.io', url: 'https://quay.io' },
    { name: 'GitHub Container', url: 'https://ghcr.io' },
    { name: 'Gitea', url: 'https://gitea.com' },
    { name: 'Codeberg', url: 'https://codeberg.org' },
    { name: 'SourceHut', url: 'https://sr.ht' },
    { zh: '腾讯云', en: 'Tencent Cloud', url: 'https://cloud.tencent.com' },
    { zh: '阿里云', en: 'Alibaba Cloud', url: 'https://aliyun.com' },
    { zh: '华为云', en: 'Huawei Cloud', url: 'https://huaweicloud.com' },
    { zh: '七牛云', en: 'Qiniu Cloud', url: 'https://qiniu.com' },
    { zh: '又拍云', en: 'Upyun CDN', url: 'https://upyun.com' },
    { name: 'Cloudflare Workers', url: 'https://workers.cloudflare.com' },
    { name: 'Cloudflare Pages', url: 'https://pages.cloudflare.com' },
    { name: 'Vercel Edge', url: 'https://vercel.com/edge' },
    { name: 'Fly Machines', url: 'https://fly.io/machines' },
    { name: 'Deno KV', url: 'https://deno.com/kv' },
  ];

  for (const site of extraSites) {
    const email = EMAILS[Math.floor(Math.random() * EMAILS.length)];
    const folders = DEMO_FOLDERS.map(f => f.id);
    ciphers.push(makeCipher({
      name: getSiteName(site, locale),
      url: site.url,
      username: email,
      password: randomPassword(),
      folderId: folders[Math.floor(Math.random() * folders.length)],
    }));
  }

  // === 1b) Same-site different-name duplicates (same URI, different titles, different users) ===
  const sameSiteDiffName = [
    { names: { zh: ['GitHub 主账号', 'GitHub 工作号'], en: ['GitHub Main', 'GitHub Work'] }, url: 'https://github.com', users: ['personal@gmail.com', 'work@company.cn'] },
    { names: { zh: ['谷歌邮箱', 'Google Mail'], en: ['Google Mail', 'Gmail Backup'] }, url: 'https://mail.google.com', users: ['main@gmail.com', 'backup@gmail.com'] },
    { names: { zh: ['AWS 根账户', 'Amazon Web Services'], en: ['AWS Root', 'Amazon Web Services'] }, url: 'https://console.aws.amazon.com', users: ['root@corp.com', 'admin@corp.com'] },
    { names: { zh: ['微博个人号', '微博营销号'], en: ['Weibo Personal', 'Weibo Marketing'] }, url: 'https://weibo.com', users: ['personal@163.com', 'marketing@qq.com'] },
    { names: { zh: ['X (Twitter)', '推特小号'], en: ['X (Twitter)', 'Twitter Alt'] }, url: 'https://x.com', users: ['main@email.com', 'alt@proton.me'] },
    { names: { zh: ['淘宝购物', '天猫会员'], en: ['Taobao Shopping', 'Tmall Member'] }, url: 'https://taobao.com', users: ['shopper@qq.com', 'member@163.com'] },
    { names: { zh: ['Discord 游戏', 'Discord 开发者'], en: ['Discord Gaming', 'Discord Dev'] }, url: 'https://discord.com', users: ['gamer@email.com', 'dev@company.io'] },
    { names: { zh: ['Slack 创业公司', 'Slack 大厂'], en: ['Slack Startup', 'Slack Corp'] }, url: 'https://slack.com', users: ['startup@io.com', 'bigcorp@company.cn'] },
    { names: { zh: ['LinkedIn 中文', 'LinkedIn EN'], en: ['LinkedIn CN', 'LinkedIn EN'] }, url: 'https://linkedin.com', users: ['cn@email.com', 'en@email.com'] },
    { names: { zh: ['Cloudflare 主站', 'CF 管理后台'], en: ['Cloudflare Main', 'CF Admin Panel'] }, url: 'https://dash.cloudflare.com', users: ['admin@xuebz.com', 'ops@company.cn'] },
  ];

  for (const dup of sameSiteDiffName) {
    const names = dup.names[locale] || dup.names.zh;
    for (let i = 0; i < names.length; i++) {
      ciphers.push(makeCipher({
        name: names[i],
        url: dup.url,
        username: dup.users[i],
        password: randomPassword(),
        folderId: 'folder-work',
      }));
    }
  }

  // === 2) Exact duplicates (~30 items, 10 groups of 3) ===
  const exactDupSources = [
    { name: 'GitHub', nameAlt: 'Github', url: 'https://github.com', user: 'demo@example.com', pw: 'MyGitP@ss2024!' },
    { name: { zh: '淘宝', en: 'Taobao' }, nameAlt: { zh: 'Taobao', en: 'Taobao Shop' }, url: 'https://taobao.com', user: 'user123@gmail.com', pw: 'TaoBao#Shop99' },
    { name: 'Google', nameAlt: { zh: '谷歌账号', en: 'Google Account' }, url: 'https://accounts.google.com', user: 'frank@xuebz.com', pw: 'G00gleM@ster!' },
    { name: 'Netflix', nameAlt: { zh: 'Netflix 家庭账号', en: 'Netflix Family' }, url: 'https://netflix.com', user: 'demo@example.com', pw: 'NetFlix2024?' },
    { name: 'Steam', nameAlt: { zh: 'Steam游戏平台', en: 'Steam Gaming' }, url: 'https://store.steampowered.com', user: 'gamer@gmail.com', pw: 'St3amG4mer!' },
    { name: 'Apple ID', nameAlt: { zh: 'Apple 账户', en: 'Apple Account' }, url: 'https://appleid.apple.com', user: 'admin@company.cn', pw: 'AppleID#2024' },
    { name: 'Dropbox', nameAlt: { zh: 'Dropbox网盘', en: 'Dropbox Storage' }, url: 'https://dropbox.com', user: 'test.user@outlook.com', pw: 'Dr0pB0x!Safe' },
    { name: { zh: '微信', en: 'WeChat' }, nameAlt: 'WeChat', url: 'https://weixin.qq.com', user: 'frank@xuebz.com', pw: 'WeChat@Msg99' },
    { name: 'Notion', nameAlt: { zh: 'Notion笔记', en: 'Notion Notes' }, url: 'https://notion.so', user: 'demo@example.com', pw: 'N0tion#Note!' },
    { name: { zh: '知乎', en: 'Zhihu' }, nameAlt: 'Zhihu', url: 'https://zhihu.com', user: 'user123@gmail.com', pw: 'ZhiHu!Ans88' },
  ];

  for (const dup of exactDupSources) {
    const dupName = typeof dup.name === 'object' ? (dup.name[locale] || dup.name.zh) : dup.name;
    const dupAltName = typeof dup.nameAlt === 'object' ? (dup.nameAlt[locale] || dup.nameAlt.zh) : dup.nameAlt;
    // Original
    ciphers.push(makeCipher({ name: dupName, url: dup.url, username: dup.user, password: dup.pw, folderId: 'folder-social' }));
    // Duplicate with different title
    ciphers.push(makeCipher({ name: dupAltName, url: dup.url, username: dup.user, password: dup.pw, folderId: 'folder-social' }));
    // Third exact copy
    ciphers.push(makeCipher({ name: dupName, url: dup.url, username: dup.user, password: dup.pw, folderId: 'folder-social' }));
  }

  // === 3) Same-site duplicates (~20 items, 10 groups of 2) — same URI, different users ===
  const sameSiteDups = [
    { name: 'Gmail', url: 'https://mail.google.com', users: ['personal@gmail.com', 'work@gmail.com'] },
    { name: 'GitHub', url: 'https://github.com', users: ['main-account@email.com', 'work-org@company.com'] },
    { name: 'AWS', url: 'https://console.aws.amazon.com', users: ['root@company.cn', 'iam-user@company.cn'] },
    { name: { zh: '微博', en: 'Weibo' }, url: 'https://weibo.com', users: ['personal@163.com', 'business@163.com'] },
    { name: 'Twitter / X', url: 'https://x.com', users: ['main@email.com', 'alt@email.com'] },
    { name: 'Amazon', url: 'https://amazon.com', users: ['shopping@gmail.com', 'prime@gmail.com'] },
    { name: 'Discord', url: 'https://discord.com', users: ['gamer@email.com', 'work@email.com'] },
    { name: 'Slack', url: 'https://slack.com', users: ['frank@startup.io', 'frank@bigcorp.com'] },
    { name: { zh: '支付宝', en: 'Alipay' }, url: 'https://alipay.com', users: ['phone1@alipay.com', 'phone2@alipay.com'] },
    { name: 'LinkedIn', url: 'https://linkedin.com', users: ['cn-profile@email.com', 'en-profile@email.com'] },
  ];

  for (const dup of sameSiteDups) {
    for (const user of dup.users) {
      const dupName = typeof dup.name === 'object' ? (dup.name[locale] || dup.name.zh) : dup.name;
      ciphers.push(makeCipher({
        name: dupName,
        url: dup.url,
        username: user,
        password: randomPassword(),
        folderId: 'folder-work',
      }));
    }
  }

  // === 4) Weak passwords (~5) ===
  const weakPwSites = locale === 'en'
    ? ['Internal Test System', 'Old WiFi Router', 'Temp Shared Account', 'Forum 1024', 'Old Forum Account']
    : ['内部测试系统', '旧WiFi路由器', '临时共享账号', '1024社区', '老论坛账号'];
  for (const name of weakPwSites) {
    ciphers.push(makeCipher({
      name,
      url: 'http://example-weak.com',
      username: 'admin',
      password: weakPassword(),
      folderId: 'folder-work',
    }));
  }

  // === 5) Empty passwords (~3, without passkeys) ===
  ciphers.push(makeCipher({ name: locale === 'en' ? 'Memo - No Password' : '记事本-无密码', url: 'https://memo.example.com', username: 'note@user.com', password: '', folderId: 'folder-work' }));
  ciphers.push(makeCipher({ name: locale === 'en' ? 'Legacy Login' : '旧系统登录', url: 'https://legacy.internal.com', username: 'legacy_user', password: '', folderId: 'folder-work' }));
  ciphers.push(makeCipher({ name: locale === 'en' ? 'Shared WiFi' : '共享WiFi', url: '', username: '', password: '', folderId: null }));

  // === 6) Stale passwords (> 1 year old) (~5) ===
  const staleSites = locale === 'en'
    ? ['Forum Registered 2022', 'Old FTP Server', 'Expired Domain Panel', 'Old iPhone Backup', 'College Email']
    : ['2022年注册的论坛', '很久没用的FTP', '过期的域名面板', '旧iPhone备份密码', '大学时代的邮箱'];
  for (const name of staleSites) {
    ciphers.push(makeCipher({
      name,
      url: 'https://stale-example.com',
      username: 'old@user.com',
      password: randomPassword(12),
      folderId: 'folder-work',
      creationDate: oldDate(),
      revisionDate: oldDate(),
    }));
  }

  // === 7) HTTP (insecure) URIs (~3) ===
  ciphers.push(makeCipher({ name: locale === 'en' ? 'Local NAS' : '本地NAS', url: 'http://192.168.1.100:5000', username: 'admin', password: randomPassword(8), folderId: 'folder-cloud' }));
  ciphers.push(makeCipher({ name: locale === 'en' ? 'Router Admin' : '路由器管理', url: 'http://192.168.1.1', username: 'admin', password: 'admin123', folderId: null }));
  ciphers.push(makeCipher({ name: locale === 'en' ? 'Company Intranet' : '公司内网系统', url: 'http://internal.company.cn', username: 'frank', password: randomPassword(10), folderId: 'folder-work' }));

  // === 8) Orphans (folder ID doesn't exist) (~5) ===
  ciphers.push(makeCipher({ name: locale === 'en' ? 'Orphan - Deleted Folder A' : '孤立项-已删除文件夹A', url: 'https://orphan1.example.com', username: 'test@user.com', password: randomPassword(), folderId: 'folder-deleted-001' }));
  ciphers.push(makeCipher({ name: locale === 'en' ? 'Orphan - Old Project B' : '孤立项-旧项目B', url: 'https://orphan2.example.com', username: 'old@project.com', password: randomPassword(), folderId: 'folder-deleted-002' }));
  ciphers.push(makeCipher({ name: locale === 'en' ? 'Orphan - Test C' : '孤立项-测试C', url: 'https://orphan3.example.com', username: 'qa@team.com', password: randomPassword(), folderId: 'folder-deleted-003' }));
  ciphers.push(makeCipher({ name: locale === 'en' ? 'Unfoldered Item 1' : '无文件夹条目1', url: 'https://nofolder1.example.com', username: 'guest@user.com', password: randomPassword(), folderId: null }));
  ciphers.push(makeCipher({ name: locale === 'en' ? 'Unfoldered Item 2' : '无文件夹条目2', url: 'https://nofolder2.example.com', username: 'temp@user.com', password: randomPassword(), folderId: null }));

  // === 9) Items with TOTP (~5) ===
  const totpSites = [locale === 'en' ? 'Google Auth Test' : 'Google Authenticator测试', 'Binance', '1Password', 'Coinbase', 'AWS IAM'];
  for (const name of totpSites) {
    ciphers.push(makeCipher({
      name,
      url: `https://${name.toLowerCase().replace(/\s/g, '')}.com`,
      username: 'secure@user.com',
      password: randomPassword(20),
      folderId: 'folder-finance',
      totp: 'otpauth://totp/Demo:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Demo',
    }));
  }

  // === 10) Items with custom fields (~5) ===
  ciphers.push(makeCipher({
    name: locale === 'en' ? 'VPN Company' : 'VPN 公司账号',
    url: 'https://vpn.company.com',
    username: 'frank@company.cn',
    password: randomPassword(),
    folderId: 'folder-work',
    fields: [
      { Name: locale === 'en' ? 'Server' : '服务器地址', Value: 'vpn.company.com:8443', Type: 0 },
      { Name: locale === 'en' ? 'Protocol' : '协议', Value: 'WireGuard', Type: 0 },
      { Name: locale === 'en' ? 'Key' : '密钥', Value: 'wg-private-key-demo-1234567890', Type: 1 },
    ],
  }));
  ciphers.push(makeCipher({
    name: locale === 'en' ? 'Database Connection' : '数据库连接',
    url: 'https://db.internal.com',
    username: 'postgres',
    password: randomPassword(),
    folderId: 'folder-dev',
    fields: [
      { Name: locale === 'en' ? 'Host' : '主机', Value: 'db.internal.com', Type: 0 },
      { Name: locale === 'en' ? 'Port' : '端口', Value: '5432', Type: 0 },
      { Name: locale === 'en' ? 'Database' : '数据库名', Value: 'production', Type: 0 },
    ],
  }));

  // === 11) Items with notes ===
  ciphers.push(makeCipher({
    name: locale === 'en' ? 'Server SSH' : '服务器 SSH',
    url: '',
    username: 'root',
    password: randomPassword(),
    folderId: 'folder-dev',
    notes: locale === 'en'
      ? 'IP: 123.45.67.89\nPort: 22\nNote: Key-only login\nBackup key in Dropbox/keys/'
      : 'IP: 123.45.67.89\n端口: 22\n注意: 只允许密钥登录\n备份密钥在 Dropbox/keys/ 目录下',
  }));

  // === 12) Favorite items ===
  ciphers.push(makeCipher({
    name: locale === 'en' ? '⭐ Most Used - Main Email' : '⭐ 最常用-主邮箱',
    url: 'https://mail.google.com',
    username: 'frank@xuebz.com',
    password: randomPassword(),
    folderId: 'folder-email',
    favorite: true,
  }));

  // === 13) Password reuse (same pw across different sites) ===
  const reusedPw = 'SamePassword2024!';
  const reuseSites = locale === 'en'
    ? ['Old Blog', 'Test Forum', 'Temp Registration']
    : ['旧博客', '测试论坛', '临时注册的网站'];
  for (const name of reuseSites) {
    ciphers.push(makeCipher({
      name,
      url: `https://${name}.example.com`,
      username: 'demo@example.com',
      password: reusedPw,
      folderId: 'folder-social',
    }));
  }

  // Build trash (a few deleted items)
  const trashItems = [];
  for (let i = 0; i < 8; i++) {
    const item = makeCipher({
      name: locale === 'en' ? `Deleted - Old ${i + 1}` : `已删除-旧账号${i + 1}`,
      url: `https://deleted${i + 1}.example.com`,
      username: `old${i}@user.com`,
      password: randomPassword(),
      folderId: null,
    });
    item.raw.DeletedDate = randomDate(25);
    trashItems.push(item);
  }

  return {
    ciphers,
    trash: trashItems,
    folders: DEMO_FOLDERS,
  };
}
