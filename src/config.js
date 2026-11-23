/**
 * Runtime configuration.
 *
 * Defaults are safe for a browser demo:
 *   - Solana devnet (or localnet if the RPC URL says so)
 *   - DRY_RUN simulated economy — no real SOL moves
 *   - guest play allowed (wallet signatures optional)
 *
 * Mainnet is refused unless ALLOW_MAINNET=true is set explicitly.
 */

const DEVNET_RPC = 'https://api.devnet.solana.com';

function detectNetwork(rpc) {
  const u = String(rpc || '').toLowerCase();
  if (/(localhost|127\.0\.0\.1|0\.0\.0\.0|localnet)/.test(u)) return 'localnet';
  if (u.includes('devnet')) return 'devnet';
  if (u.includes('testnet') && !u.includes('mainnet')) return 'testnet';
  if (u.includes('mainnet')) return 'mainnet-beta';
  return 'custom';
}

function loadConfig(env = process.env) {
  const warnings = [];
  const errors = [];

  const rpc = env.SOLANA_RPC || DEVNET_RPC;
  const network = env.SOLANA_NETWORK || detectNetwork(rpc);
  const dryRun = env.DRY_RUN !== 'false';
  const mainnetLike = network === 'mainnet-beta' || /mainnet/i.test(String(rpc));

  if (mainnetLike && env.ALLOW_MAINNET !== 'true') {
    errors.push(
      'Refusing to use Solana mainnet. Leave SOLANA_RPC unset (devnet) or point it at devnet/localnet. ' +
      'Set ALLOW_MAINNET=true only if you intentionally accept a mainnet RPC. ' +
      'The default economy is simulated and does not move real funds.'
    );
  }

  let starter = dryRun ? 2_000_000_000 : 0;
  if (env.STARTER_GRANT_LAMPORTS !== undefined && env.STARTER_GRANT_LAMPORTS !== '') {
    const parsed = parseInt(env.STARTER_GRANT_LAMPORTS, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      warnings.push('STARTER_GRANT_LAMPORTS is invalid — ignoring it');
    } else {
      starter = parsed;
    }
  }

  if (!env.DATABASE_URL) warnings.push('DATABASE_URL not set — running in memory-only mode (no persistence)');
  if (!env.FEE_WALLET) warnings.push('FEE_WALLET not set — protocol fees stay in the simulated ledger');
  if (dryRun) warnings.push(`DRY_RUN=true — economy is simulated on ${network}; no real SOL moves`);
  else warnings.push(`DRY_RUN=false — bridge transfers are live on ${network}`);
  if (env.REQUIRE_WALLET_AUTH !== 'true') warnings.push('REQUIRE_WALLET_AUTH is off — guest play is allowed');
  if (!env.OPERATOR_SECRET) warnings.push('OPERATOR_SECRET not set — operator endpoints are unauthenticated');
  if (!env.ADMIN_KEY) warnings.push('ADMIN_KEY not set — admin endpoints are unauthenticated');
  if (!env.CORS_ORIGINS) warnings.push('CORS_ORIGINS not set — allowing all origins (*)');
  if (network === 'custom' && !mainnetLike) {
    warnings.push('SOLANA_RPC has no recognizable network name — labeled "custom". Confirm it is devnet or localnet.');
  }

  return {
    PORT: parseInt(env.PORT || '3000', 10),
    WS_PORT: parseInt(env.WS_PORT || '8080', 10),
    API_PORT: parseInt(env.API_PORT || env.PORT || '3000', 10),
    TICK_RATE: parseInt(env.TICK_RATE || '1000', 10),
    PERCEPTION_RADIUS: parseInt(env.PERCEPTION_RADIUS || '10', 10),
    ZONE_SIZE: parseInt(env.ZONE_SIZE || '64', 10),
    SOLANA_RPC: rpc,
    SOLANA_NETWORK: network,
    DRY_RUN: dryRun,
    FEE_WALLET: env.FEE_WALLET || null,
    DATABASE_URL: env.DATABASE_URL || null,
    DB_SAVE_INTERVAL: parseInt(env.DB_SAVE_INTERVAL || '30000', 10),
    REQUIRE_WALLET_AUTH: env.REQUIRE_WALLET_AUTH === 'true',
    STARTER_GRANT_LAMPORTS: starter,
    OPERATOR_CONTROLS: Boolean(env.OPERATOR_SECRET || env.ADMIN_KEY),
    warnings,
    errors,
  };
}

function publicConfig(config) {
  return {
    dryRun: config.DRY_RUN,
    network: config.SOLANA_NETWORK,
    requireWalletAuth: config.REQUIRE_WALLET_AUTH,
    simulatedEconomy: config.DRY_RUN,
    guestPlay: !config.REQUIRE_WALLET_AUTH,
    starterGrantSOL: config.STARTER_GRANT_LAMPORTS / 1e9,
    operatorControls: Boolean(config.OPERATOR_CONTROLS),
    tickRate: config.TICK_RATE,
    zoneSize: config.ZONE_SIZE,
    version: '0.3.1',
  };
}

module.exports = { loadConfig, publicConfig, detectNetwork, DEVNET_RPC };
