/**
 * i18n — Internationalization module
 * Supports: zh (Chinese) / en (English)
 */

let currentLocale = 'zh';

const translations = {
  // === Login Page ===
  'login.title': { zh: '密码管理面板', en: 'Password Manager' },
  'login.subtitle': { zh: '安全连接你的保险库 · 智能去重 · 批量管理 · 健康分析', en: 'Secure vault · Smart dedup · Batch ops · Health check' },
  'login.server': { zh: '服务器', en: 'Server' },
  'login.server.official': { zh: 'bitwarden.com（官方）', en: 'bitwarden.com (Official)' },
  'login.server.eu': { zh: 'bitwarden.eu（欧洲）', en: 'bitwarden.eu (Europe)' },
  'login.tab.apikey': { zh: '🔑 API Key（推荐）', en: '🔑 API Key (Recommended)' },
  'login.tab.credfile': { zh: '🔐 加密文件', en: '🔐 Encrypted File' },
  'login.apikey.info': { zh: '💡 在 <a href="https://vault.bitwarden.com" target="_blank" rel="noopener">Bitwarden 网页版</a> → <strong>设置</strong> → <strong>安全</strong> → <strong>密钥</strong> → 查看 API 密钥', en: '💡 Go to <a href="https://vault.bitwarden.com" target="_blank" rel="noopener">Bitwarden Web</a> → <strong>Settings</strong> → <strong>Security</strong> → <strong>Keys</strong> → View API Key' },
  'login.email.label': { zh: '邮箱（用于密钥派生）', en: 'Email (for key derivation)' },
  'login.email.placeholder': { zh: '你的 Bitwarden 邮箱', en: 'Your Bitwarden email' },
  'login.password.label': { zh: '主密码（仅本地解密，不上传）', en: 'Master password (local decrypt only)' },
  'login.password.placeholder': { zh: '你的主密码', en: 'Your master password' },
  'login.secret.placeholder': { zh: '你的 API secret', en: 'Your API secret' },
  'login.btn': { zh: '登录并分析', en: 'Login & Analyze' },
  'login.demo': { zh: '🎮 点击进入演示页面', en: '🎮 Enter Demo Mode' },
  'login.security': { zh: '所有解密操作在本地浏览器完成，主密码不会发送到任何第三方服务器', en: 'All decryption happens locally in your browser. Master password never leaves your device.' },
  'login.credfile.info': { zh: '🔐 使用加密凭证文件一键登录。登录后可在侧边栏「加密登录」生成文件。', en: '🔐 One-click login with encrypted credential file. Generate one from sidebar after login.' },
  'login.credfile.drop': { zh: '将加密凭证文件拖拽到此处', en: 'Drop encrypted credential file here' },
  'login.credfile.or': { zh: '或', en: 'or' },
  'login.credfile.browse': { zh: '📂 选择文件', en: '📂 Browse' },
  'login.opensource': { zh: '🔓 本项目已开源，请放心使用', en: '🔓 This project is open source' },
  'login.opensource.link': { zh: '查看源码', en: 'View Source' },

  // === Login Status ===
  'status.restoring': { zh: '正在恢复会话...', en: 'Restoring session...' },
  'status.connecting': { zh: '正在连接 Bitwarden...', en: 'Connecting to Bitwarden...' },
  'status.apikey.login': { zh: '使用 API Key 登录...', en: 'Logging in with API Key...' },
  'status.kdf': { zh: '本地密钥派生中', en: 'Deriving key locally' },
  'status.kdf.rounds': { zh: '轮', en: 'rounds' },
  'status.decrypt.key': { zh: '解密密钥...', en: 'Decrypting keys...' },
  'status.sync': { zh: '同步保险库...', en: 'Syncing vault...' },
  'status.decrypt.analyze': { zh: '解密并分析条目...', en: 'Decrypting & analyzing...' },
  'status.fill.all': { zh: '请填写所有字段', en: 'Please fill in all fields' },
  'status.login.fail': { zh: 'API Key 登录失败', en: 'API Key login failed' },

  // === Sidebar ===
  'nav.overview': { zh: '总览', en: 'Overview' },
  'nav.all': { zh: '全部条目', en: 'All Items' },
  'nav.duplicates': { zh: '重复项', en: 'Duplicates' },
  'nav.orphans': { zh: '孤立项', en: 'Orphans' },
  'nav.nofolder': { zh: '无文件夹', en: 'No Folder' },
  'nav.health': { zh: '健康分析', en: 'Health' },
  'nav.trash': { zh: '回收站', en: 'Trash' },
  'nav.credfile': { zh: '加密登录', en: 'Cred File' },
  'nav.logout': { zh: '退出', en: 'Logout' },
  'nav.folders': { zh: '📁 文件夹', en: '📁 Folders' },
  'nav.folders.add': { zh: '新建文件夹', en: 'New Folder' },
  'nav.sync': { zh: '同步', en: 'Sync' },

  // === Demo ===
  'demo.banner': { zh: '🎮 演示模式', en: '🎮 Demo Mode' },
  'demo.banner.sub': { zh: '所有操作仅在本地生效', en: 'All changes are local only' },

  // === Search / Filter ===
  'search.placeholder': { zh: '搜索名称、用户名、URL...  (按 / 聚焦)', en: 'Search name, user, URL...  (press / to focus)' },
  'sort.name.asc': { zh: '名称 A→Z', en: 'Name A→Z' },
  'sort.name.desc': { zh: '名称 Z→A', en: 'Name Z→A' },
  'sort.date.desc': { zh: '最新修改', en: 'Latest' },
  'sort.date.asc': { zh: '最早修改', en: 'Oldest' },

  // === Batch Actions ===
  'batch.selected': { zh: '已选', en: 'selected' },
  'batch.move': { zh: '📁 移动到文件夹', en: '📁 Move to Folder' },
  'batch.delete': { zh: '🗑️ 删除', en: '🗑️ Delete' },
  'batch.cancel': { zh: '✕ 取消', en: '✕ Cancel' },
  'batch.delete.title': { zh: '批量删除', en: 'Batch Delete' },
  'batch.delete.msg': { zh: '个条目吗？\n条目将移入回收站，30天内可恢复。', en: ' items?\nItems will be moved to trash and recoverable for 30 days.' },

  // === Overview ===
  'overview.title': { zh: '总条目', en: 'Total' },
  'overview.logins': { zh: '登录项', en: 'Logins' },
  'overview.dup.groups': { zh: '重复组', en: 'Dup Groups' },
  'overview.cleanable': { zh: '可清理', en: 'Cleanable' },
  'overview.orphans': { zh: '孤立项', en: 'Orphans' },
  'overview.health.score': { zh: '健康评分', en: 'Health Score' },
  'overview.weak': { zh: '弱密码', en: 'Weak Pwd' },
  'overview.empty': { zh: '空密码', en: 'Empty Pwd' },
  'overview.reused': { zh: '密码复用', en: 'Reused' },
  'overview.stale': { zh: '超过1年未更新', en: 'Stale >1yr' },
  'overview.nourl': { zh: '无URL', en: 'No URL' },
  'overview.quick': { zh: '⚡ 快捷操作', en: '⚡ Quick Actions' },
  'overview.quick.dedup': { zh: '一键清理重复项', en: 'Clean Duplicates' },
  'overview.quick.weak': { zh: '查看弱密码', en: 'View Weak Passwords' },
  'overview.quick.nourl': { zh: '搜索无URL条目', en: 'Find No-URL Items' },
  'overview.quick.notitle': { zh: '搜索无标题条目', en: 'Find Untitled Items' },
  'overview.quick.nofolder': { zh: '搜索无文件夹条目', en: 'Find Unfoldered Items' },

  // === Duplicates ===
  'dup.exact': { zh: '完全重复', en: 'Exact Dup' },
  'dup.merge': { zh: '需合并', en: 'Merge' },
  'dup.samesite': { zh: '同站重复', en: 'Same Site' },
  'dup.title.warn': { zh: '名称', en: 'Name' },
  'dup.keep': { zh: '保留', en: 'Keep' },
  'dup.remove': { zh: '删除', en: 'Remove' },
  'dup.items': { zh: '个条目', en: 'items' },
  'dup.merge.all': { zh: '🔀 一键合并', en: '🔀 Merge All' },
  'dup.merge.group': { zh: '合并此组', en: 'Merge Group' },
  'dup.same.url.user.pw': { zh: '同 URL + 同用户名 + 同密码', en: 'Same URL + user + password' },
  'dup.same.url': { zh: '同 URL', en: 'Same URL' },
  'dup.empty': { zh: '🎉 没有发现重复项！你的保险库很干净。', en: '🎉 No duplicates found! Your vault is clean.' },
  'dup.groups': { zh: '组', en: 'groups' },
  'dup.exact.hint': { zh: '同 URL + 同用户名 + 同密码', en: 'Same URL + username + password' },
  'dup.candelete': { zh: '✅ 可直接删除', en: '✅ Can Delete' },
  'dup.needmerge': { zh: '🔀 需合并', en: '🔀 Needs Merge' },
  'dup.samesite.hint': { zh: '✅ 勾选要合并的条目，未勾选的保持不变', en: '✅ Check items to merge, unchecked items remain unchanged' },
  'dup.samesite.badge': { zh: '同站', en: 'Same Site' },
  'dup.accounts': { zh: '个账号', en: 'accounts' },
  'dup.entries': { zh: '条', en: 'entries' },
  'dup.merge.btn': { zh: '🔀 一键合并', en: '🔀 Merge All' },
  'dup.select.all': { zh: '☑ 全选', en: '☑ Select All' },
  'dup.deselect.all': { zh: '☐ 反选', en: '☐ Deselect All' },
  'dup.merge.single': { zh: '🔀 合并', en: '🔀 Merge' },
  'dup.merge.single.ing': { zh: '合并中...', en: 'Merging...' },
  'dup.merge.single.done': { zh: '✅ 完成', en: '✅ Done' },
  'dup.merge.select.hint': { zh: '请先选择要处理的项目', en: 'Please select items first' },

  // === Orphans ===
  'orphan.empty': { zh: '✅ 没有孤立项。', en: '✅ No orphan items found.' },
  'orphan.title': { zh: '孤立项', en: 'Orphan Items' },

  // === Select ===
  'select.all': { zh: '全选', en: 'Select All' },

  // === Trash ===
  'trash.empty': { zh: '✅ 回收站为空', en: '✅ Trash is empty' },
  'trash.title': { zh: '回收站', en: 'Trash' },
  'trash.hint': { zh: '条目将在 30 天后自动永久删除', en: 'Items will be permanently deleted after 30 days' },
  'trash.restore': { zh: '🔄 恢复到文件夹', en: '🔄 Restore' },
  'trash.permdelete': { zh: '⛔ 永久删除', en: '⛔ Delete Permanently' },
  'trash.cancel': { zh: '✕ 取消', en: '✕ Cancel' },
  'trash.deletedon': { zh: '删除于', en: 'Deleted on' },

  // === Health ===
  'health.title': { zh: '密码健康分析', en: 'Password Health Analysis' },
  'health.weak': { zh: '弱密码', en: 'Weak Passwords' },
  'health.empty': { zh: '🎉 保险库非常健康！所有密码都很安全。', en: '🎉 Your vault is perfectly healthy! All passwords are secure.' },
  'health.reused': { zh: '密码复用', en: 'Password Reuse' },
  'health.stale': { zh: '超过1年未更新', en: 'Not Updated >1yr' },
  'health.nourl': { zh: '无 URL 条目', en: 'No URL Items' },
  'health.http': { zh: 'HTTP 不安全', en: 'HTTP Insecure' },
  'health.totp': { zh: '有 TOTP', en: 'Has TOTP' },
  'health.notitle': { zh: '无标题', en: 'Untitled' },
  'health.passkey': { zh: '有通行密钥', en: 'Has Passkey' },
  'health.score.label': { zh: '评分', en: 'Score' },
  'health.more': { zh: '...还有更多', en: '...and more' },
  'health.empty.pw': { zh: '空密码（无 Passkey）', en: 'Empty Passwords (no Passkey)' },

  // === Items ===
  'item.untitled': { zh: '(无标题)', en: '(Untitled)' },
  'item.unnamed.folder': { zh: '(未命名)', en: '(Unnamed)' },
  'item.decrypt.fail': { zh: '(解密失败)', en: '(decrypt failed)' },
  'item.no.folder': { zh: '无文件夹', en: 'No Folder' },
  'item.items': { zh: '条目', en: 'items' },
  'item.selectall': { zh: '全选', en: 'Select All' },
  'item.results': { zh: '条结果', en: 'results' },

  // === Detail / Edit ===
  'detail.name': { zh: '名称', en: 'Name' },
  'detail.username': { zh: '用户名', en: 'Username' },
  'detail.password': { zh: '密码', en: 'Password' },
  'detail.url': { zh: 'URL', en: 'URL' },
  'detail.notes': { zh: '备注', en: 'Notes' },
  'detail.folder': { zh: '文件夹', en: 'Folder' },
  'detail.totp': { zh: 'TOTP', en: 'TOTP' },
  'detail.fields': { zh: '自定义字段', en: 'Custom Fields' },
  'detail.created': { zh: '创建时间', en: 'Created' },
  'detail.updated': { zh: '修改时间', en: 'Modified' },
  'detail.save': { zh: '💾 保存修改', en: '💾 Save Changes' },
  'detail.delete': { zh: '🗑️ 删除此条目', en: '🗑️ Delete Item' },
  'detail.delete.trash': { zh: '删除条目', en: 'Delete Item' },
  'detail.delete.confirm': { zh: '确定要删除此条目吗？\n条目将移入回收站，30天内可恢复。', en: 'Delete this item?\nIt will be moved to trash and recoverable for 30 days.' },
  'detail.save.ok': { zh: '✅ 修改已保存', en: '✅ Changes saved' },
  'detail.save.fail': { zh: '❌ 保存失败', en: '❌ Save failed' },
  'detail.delete.ok': { zh: '✅ 条目已删除', en: '✅ Item deleted' },
  'detail.delete.fail': { zh: '❌ 删除失败', en: '❌ Delete failed' },

  // === Folder ===
  'folder.empty': { zh: '暂无文件夹', en: 'No folders' },
  'folder.rename': { zh: '重命名', en: 'Rename' },
  'folder.delete': { zh: '删除', en: 'Delete' },
  'folder.new': { zh: '新建文件夹', en: 'New Folder' },
  'folder.rename.title': { zh: '重命名文件夹', en: 'Rename Folder' },
  'folder.name.input': { zh: '文件夹名称', en: 'Folder name' },
  'folder.delete.title': { zh: '删除文件夹', en: 'Delete Folder' },
  'folder.delete.msg1': { zh: '确定删除文件夹「', en: 'Delete folder "' },
  'folder.delete.msg2': { zh: '」吗？\n文件夹内的 ', en: '"?\nThe ' },
  'folder.delete.msg3': { zh: ' 个条目不会被删除，仅取消归类。', en: ' items inside will not be deleted, just uncategorized.' },
  'folder.created.ok': { zh: '已创建', en: 'created' },
  'folder.renamed.ok': { zh: '已重命名为', en: 'renamed to' },
  'folder.deleted.ok': { zh: '已删除', en: 'deleted' },
  'folder.select': { zh: '请从左侧选择一个文件夹', en: 'Select a folder from sidebar' },
  'folder.unknown': { zh: '未知文件夹', en: 'Unknown Folder' },
  'folder.none': { zh: '无文件夹（取消归类）', en: 'No Folder (remove from folder)' },
  'folder.name.required': { zh: '请输入文件夹名称', en: 'Please enter folder name' },
  'folder.move.ok': { zh: '已移动到', en: 'moved to' },

  // === Modal ===
  'modal.cancel': { zh: '取消', en: 'Cancel' },
  'modal.confirm': { zh: '确认', en: 'Confirm' },
  'modal.processing': { zh: '处理中...', en: 'Processing...' },

  // === Trash ===
  'trash.deleted': { zh: '删除于', en: 'Deleted' },
  'trash.restore': { zh: '恢复', en: 'Restore' },
  'trash.restore.ok': { zh: '✅ 已恢复', en: '✅ Restored' },
  'trash.perma.delete': { zh: '彻底删除', en: 'Delete Permanently' },
  'trash.perma.title': { zh: '彻底删除', en: 'Permanent Delete' },
  'trash.perma.msg': { zh: '此操作不可撤销，条目将被永久删除。', en: 'This action cannot be undone. Item will be permanently deleted.' },
  'trash.perma.ok': { zh: '✅ 已彻底删除', en: '✅ Permanently deleted' },
  'trash.empty': { zh: '回收站为空', en: 'Trash is empty' },

  // === Merge ===
  'merge.title': { zh: '合并重复项', en: 'Merge Duplicates' },
  'merge.progress': { zh: '合并进度', en: 'Merge Progress' },
  'merge.ok': { zh: '合并完成', en: 'Merge Complete' },
  'merge.fail': { zh: '合并失败', en: 'Merge Failed' },
  'merge.success': { zh: '成功合并', en: 'Successfully merged' },
  'merge.groups': { zh: '组', en: 'groups' },

  // === Toasts ===
  'toast.session.restored': { zh: '✅ 会话已恢复', en: '✅ Session restored' },
  'toast.network.lost': { zh: '⚠️ 网络已断开，操作可能失败', en: '⚠️ Network lost, operations may fail' },
  'toast.network.back': { zh: '✅ 网络已恢复', en: '✅ Network restored' },
  'toast.sync.ok': { zh: '✅ 同步完成', en: '✅ Sync complete' },
  'toast.sync.fail': { zh: '❌ 同步失败', en: '❌ Sync failed' },
  'toast.op.fail': { zh: '❌ 操作失败', en: '❌ Operation failed' },
  'toast.copied': { zh: '✅ 已复制到剪贴板', en: '✅ Copied to clipboard' },

  // === Credfile ===
  'credfile.title': { zh: '生成加密凭证文件', en: 'Generate Encrypted Credential File' },
  'credfile.desc': { zh: '将当前登录凭证加密保存为文件。下次可通过拖入文件一键登录，无需再输入 API Key 和密码。', en: 'Encrypt current credentials to a file. Next time, just drag the file to login instantly—no API Key or password needed.' },
  'credfile.passphrase': { zh: '设置文件密码', en: 'Set file password' },
  'credfile.passphrase.placeholder': { zh: '保护你的凭证文件', en: 'Protect your credential file' },
  'credfile.generate': { zh: '🔐 生成并下载', en: '🔐 Generate & Download' },
  'credfile.security': { zh: '⚠️ 安全提示：凭证文件使用 AES-256-GCM 加密保护。请妥善保管文件密码，遗失后无法恢复。', en: '⚠️ Security: File is protected with AES-256-GCM encryption. Keep your file password safe—it cannot be recovered.' },

  // === Misc ===
  'meta.title.zh': { zh: 'Bitwarden Vault Manager — 密码管理面板', en: 'Bitwarden Vault Manager — Password Dashboard' },
  'move.title': { zh: '移动到文件夹', en: 'Move to Folder' },

  // === Orphan view ===
  'orphans.title': { zh: '孤立项', en: 'Orphans' },
  'orphans.desc': { zh: '以下条目的文件夹已不存在', en: 'These items belong to deleted folders' },
  'orphans.originalFolder': { zh: '原文件夹', en: 'Original Folder' },

  // === No Folder view ===
  'nofolder.title': { zh: '无文件夹条目', en: 'Unfoldered Items' },

  // === Downloads ===
  'download.csv': { zh: '导出 CSV', en: 'Export CSV' },
  'download.json': { zh: '导出 JSON', en: 'Export JSON' },

  // === Detail Drawer ===
  'detail.type': { zh: '类型', en: 'Type' },
  'detail.type.login': { zh: '🔐 登录', en: '🔐 Login' },
  'detail.type.note': { zh: '📝 安全笔记', en: '📝 Secure Note' },
  'detail.type.card': { zh: '💳 卡片', en: '💳 Card' },
  'detail.type.identity': { zh: '🪪 身份', en: '🪪 Identity' },
  'detail.type.unknown': { zh: '未知', en: 'Unknown' },
  'detail.section.info': { zh: '项目信息', en: 'Item Info' },
  'detail.section.login': { zh: '登录凭据', en: 'Login Credentials' },
  'detail.section.autofill': { zh: '自动填充选项', en: 'Autofill Options' },
  'detail.section.card': { zh: '卡片信息', en: 'Card Info' },
  'detail.section.identity': { zh: '身份信息', en: 'Identity Info' },
  'detail.section.fields': { zh: '自定义字段', en: 'Custom Fields' },
  'detail.section.extra': { zh: '附加选项', en: 'Extra Options' },
  'detail.favorite': { zh: '收藏', en: 'Favorite' },
  'detail.favorited': { zh: '⭐ 已收藏', en: '⭐ Favorited' },
  'detail.org': { zh: '组织', en: 'Organization' },
  'detail.totp.key': { zh: '验证器密钥 (TOTP)', en: 'Authenticator Key (TOTP)' },
  'detail.pw.date': { zh: '密码修改日期', en: 'Password Changed' },
  'detail.passkey': { zh: '通行密钥', en: 'Passkey' },
  'detail.passkey.count': { zh: '个通行密钥', en: ' passkeys' },
  'detail.uri': { zh: '网站 (URI)', en: 'Website (URI)' },
  'detail.card.brand': { zh: '品牌', en: 'Brand' },
  'detail.card.holder': { zh: '持卡人', en: 'Cardholder' },
  'detail.card.number': { zh: '卡号', en: 'Card No.' },
  'detail.card.expiry': { zh: '有效期', en: 'Expiry' },
  'detail.card.cvv': { zh: '安全码', en: 'CVV' },
  'detail.id.title': { zh: '称谓', en: 'Title' },
  'detail.id.first': { zh: '名', en: 'First' },
  'detail.id.middle': { zh: '中间名', en: 'Middle' },
  'detail.id.last': { zh: '姓', en: 'Last' },
  'detail.id.company': { zh: '公司', en: 'Company' },
  'detail.id.email': { zh: '邮箱', en: 'Email' },
  'detail.id.phone': { zh: '电话', en: 'Phone' },
  'detail.id.user': { zh: '用户名', en: 'Username' },
  'detail.id.passport': { zh: '护照号', en: 'Passport' },
  'detail.id.license': { zh: '驾照号', en: 'License' },
  'detail.id.ssn': { zh: 'SSN', en: 'SSN' },
  'detail.id.addr1': { zh: '地址1', en: 'Address 1' },
  'detail.id.addr2': { zh: '地址2', en: 'Address 2' },
  'detail.id.addr3': { zh: '地址3', en: 'Address 3' },
  'detail.id.city': { zh: '城市', en: 'City' },
  'detail.id.state': { zh: '州/省', en: 'State' },
  'detail.id.zip': { zh: '邮编', en: 'Zip' },
  'detail.id.country': { zh: '国家', en: 'Country' },
  'detail.field.noname': { zh: '(无名)', en: '(unnamed)' },
  'detail.field.yes': { zh: '✅ 是', en: '✅ Yes' },
  'detail.field.no': { zh: '❌ 否', en: '❌ No' },
  'detail.reprompt': { zh: '主密码重新提示', en: 'Master Password Re-prompt' },
  'detail.reprompt.enabled': { zh: '✅ 已启用', en: '✅ Enabled' },
  'detail.date.modified': { zh: '修改日期', en: 'Modified' },
  'detail.date.created': { zh: '创建日期', en: 'Created' },
  'detail.btn.edit': { zh: '✏️ 编辑条目', en: '✏️ Edit Item' },
  'detail.btn.delete': { zh: '🗑️ 删除条目', en: '🗑️ Delete Item' },

  // === Edit Form ===
  'edit.title.prefix': { zh: '编辑 - ', en: 'Edit - ' },
  'edit.section.info': { zh: '项目信息', en: 'Item Info' },
  'edit.label.name': { zh: '项目名称', en: 'Item Name' },
  'edit.label.folder': { zh: '文件夹', en: 'Folder' },
  'edit.folder.none': { zh: '-- 无文件夹 --', en: '-- No Folder --' },
  'edit.section.login': { zh: '登录凭据', en: 'Login Credentials' },
  'edit.label.user': { zh: '用户名', en: 'Username' },
  'edit.label.pw': { zh: '密码', en: 'Password' },
  'edit.section.uris': { zh: '网站 (URIs)', en: 'Website (URIs)' },
  'edit.add.uri': { zh: '+ 添加 URI', en: '+ Add URI' },
  'edit.section.notes': { zh: '备注', en: 'Notes' },
  'edit.btn.save': { zh: '💾 保存修改', en: '💾 Save Changes' },
  'edit.btn.cancel': { zh: '✕ 取消', en: '✕ Cancel' },

  // === Folder View ===
  'folder.view.empty': { zh: '这个文件夹是空的', en: 'This folder is empty' },

  // === Overview Extra ===
  'overview.folders': { zh: '文件夹', en: 'Folders' },
  'overview.trash': { zh: '回收站', en: 'Trash' },
  'overview.chart.title': { zh: '类型分布', en: 'Type Distribution' },
  'overview.notes': { zh: '安全笔记', en: 'Secure Notes' },
  'overview.cards': { zh: '卡片', en: 'Cards' },
  'overview.identities': { zh: '身份', en: 'Identities' },

  // === Sync / Logout ===
  'sync.syncing': { zh: '⏳ 同步中...', en: '⏳ Syncing...' },
  'sync.analyzing': { zh: '⏳ 分析中...', en: '⏳ Analyzing...' },
  'logout.title': { zh: '退出登录', en: 'Logout' },
  'logout.msg': { zh: '确定要退出登录吗？', en: 'Are you sure you want to logout?' },

  // === Credfile Extra ===
  'credfile.generating': { zh: '生成中...', en: 'Generating...' },
  'credfile.ok': { zh: '✅ 凭证文件已下载', en: '✅ Credential file downloaded' },
  'credfile.fail': { zh: '❌ 生成失败', en: '❌ Generation failed' },
  'credfile.pw.required': { zh: '请输入文件密码', en: 'Please enter file password' },
  'credfile.login.ok': { zh: '✅ 凭证文件登录成功', en: '✅ Credential file login success' },
  'credfile.login.fail': { zh: '❌ 凭证文件登录失败', en: '❌ Credential file login failed' },
  'credfile.pw.prompt': { zh: '请输入凭证文件密码：', en: 'Enter credential file password:' },
  'credfile.decrypting': { zh: '解密凭证文件...', en: 'Decrypting credential file...' },

  // === Health Extra ===
  'health.score.great': { zh: '优秀', en: 'Great' },
  'health.score.good': { zh: '良好', en: 'Good' },
  'health.score.fair': { zh: '一般', en: 'Fair' },
  'health.score.poor': { zh: '较差', en: 'Poor' },
  'health.count': { zh: '项', en: '' },
  'health.items.affected': { zh: '个受影响的条目', en: ' affected items' },
  'health.group.title': { zh: '此密码被以下条目共用', en: 'This password is shared by' },

  // === Merge Extra ===
  'merge.merging': { zh: '正在合并...', en: 'Merging...' },
  'merge.step': { zh: '步骤', en: 'Step' },
  'merge.of': { zh: '/', en: '/' },
  'merge.confirm.title': { zh: '确认合并', en: 'Confirm Merge' },
  'merge.confirm.msg': { zh: '组重复条目？此操作将保留每组最新条目并删除其余条目。', en: ' duplicate groups? This will keep the newest item in each group and delete the rest.' },
};

export function t(key, ...args) {
  const entry = translations[key];
  if (!entry) return key;
  let text = entry[currentLocale] || entry['zh'] || key;
  // Simple template replacement: {0}, {1}, etc.
  args.forEach((arg, i) => {
    text = text.replace(`{${i}}`, arg);
  });
  return text;
}

export function getLocale() {
  return currentLocale;
}

export function setLocale(lang) {
  if (lang !== 'zh' && lang !== 'en') return;
  currentLocale = lang;
  localStorage.setItem('bw-locale', lang);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = t('meta.title.zh');
  applyLocale();
  window.dispatchEvent(new CustomEvent('localeChanged', { detail: { locale: lang } }));
}

export function initLocale() {
  const saved = localStorage.getItem('bw-locale');
  if (saved && (saved === 'zh' || saved === 'en')) {
    currentLocale = saved;
  } else {
    const browserLang = navigator.language || navigator.userLanguage || 'zh';
    currentLocale = browserLang.startsWith('zh') ? 'zh' : 'en';
  }
  document.documentElement.lang = currentLocale === 'zh' ? 'zh-CN' : 'en';
  document.title = t('meta.title.zh');
  applyLocale();
}

function applyLocale() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const entry = translations[key];
    if (entry) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = entry[currentLocale] || entry['zh'];
      } else if (el.getAttribute('data-i18n-html') !== null) {
        el.innerHTML = entry[currentLocale] || entry['zh'];
      } else {
        el.textContent = entry[currentLocale] || entry['zh'];
      }
    }
  });
}
