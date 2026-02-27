import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

const frontendDir = join(process.cwd(), 'frontend')

if (!existsSync(join(frontendDir, 'node_modules'))) {
  console.log('[v0] Installing frontend dependencies...')
  execSync('npm install', { cwd: frontendDir, stdio: 'inherit' })
  console.log('[v0] Frontend dependencies installed.')
} else {
  console.log('[v0] node_modules already exists, skipping install.')
}
