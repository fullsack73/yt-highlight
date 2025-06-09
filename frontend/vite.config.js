import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 애플리케이션이 도메인의 루트에서 제공되도록 base 경로를 '/'로 설정합니다.
  base: '/',
  // server 옵션은 개발 환경에서만 사용되므로 프로덕션 빌드와 무관합니다.
  // 혼동을 피하기 위해 제거하거나 그대로 두어도 괜찮습니다.
  // 이번에는 깔끔하게 제거하겠습니다.
})