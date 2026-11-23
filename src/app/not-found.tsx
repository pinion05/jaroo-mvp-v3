import Link from 'next/link'

// 존재하지 않는 경로의 404 표면(TC-BBF-007) — Next.js 기본 영문 404 대신
// 한국어 안내 + '홈으로 돌아가기' 복귀 진출점을 제공한다. 루트 layout 의
// 390px 폰 프레임 안에 렌더링되므로 앱 톤(시안 폰트·색상)에 맞춘다.
export default function NotFound() {
  return (
    <main
      className='flex h-full w-full flex-col items-center justify-center px-8 text-center'
      style={{ fontFamily: "-apple-system, 'Pretendard', sans-serif" }}
    >
      <div className='text-[56px] font-bold leading-none tracking-[-2px] text-[#0f1419]' aria-hidden='true'>
        404
      </div>
      <h1 className='mt-5 text-[18px] font-bold tracking-[-0.01em] text-[#0f1419]'>페이지를 찾을 수 없어요</h1>
      <p className='mt-2 text-[13px] leading-[1.6] text-[#5a6473]'>
        주소가 잘못 입력되었거나 변경·삭제된 페이지예요.
        <br />
        주소를 다시 확인하거나 홈으로 돌아가주세요.
      </p>
      <Link
        href='/home'
        className='mt-7 flex h-[46px] w-full max-w-[260px] items-center justify-center rounded-[12px] bg-[#0f1419] text-[14px] font-semibold text-white shadow-[0_4px_12px_rgba(15,20,25,0.28)]'
      >
        홈으로 돌아가기
      </Link>
    </main>
  )
}
