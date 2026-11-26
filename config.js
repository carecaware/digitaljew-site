/* Configuração do site. Os instaladores e as notas das versões vêm das releases do repositório
   privado carecaware/releases, pela função download-instalador do Supabase (ver README). */
window.DIGITALJEW_CONFIG = {
  productName: "BarFácil",
  windowsAssetPattern: /\.(exe|msi)$/i,
  androidAssetPattern: /\.apk$/i,

  /* Cadastro de clientes (cadastro.html) — projeto Supabase do BarFácil.
     A chave "publishable" é pública por natureza: pode ficar no site. */
  supabaseUrl: "https://sydjqruprgixevqcrhdv.supabase.co",
  supabaseKey: "sb_publishable_-Ht37rNyJ83bWWpuZSe37g_HnENbcI9",
  /* Precisa bater com a validade configurada no Supabase (Authentication → Providers → Email e Phone). */
  codeTtlMinutes: 10,
  /* Quantidade de dígitos do código (igual ao Supabase: Authentication -> Providers -> Email). */
  codeLength: 6,
  /* Intervalo mínimo entre pedidos de código (o padrão do Supabase é 60 s). */
  resendCooldownSeconds: 60,

  /* Valor mensal mostrado na área do cliente (deixe null para não mostrar). Ex.: basica: 29.90 */
  precos: { basica: null, premium: null }
};
