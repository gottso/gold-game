// 게임 공용 서버 설정 (공개해도 되는 값만). Twelve Data 키는 Supabase 비밀값에만 있다.
export const SB_URL = 'https://zpztmhjrhzddvlonbyhp.supabase.co';
export const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpwenRtaGpyaHpkZHZsb25ieWhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyODgzOTMsImV4cCI6MjA5Nzg2NDM5M30.mAw6euNmv48R0lH5Hfgsnoizb6-L9K8ft9JhyICIkdc';
export const SB_H = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
export const TD_PROXY = { url: SB_URL + '/functions/v1/td-proxy', headers: SB_H };
