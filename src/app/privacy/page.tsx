import type { ReactNode } from 'react'
import { LegalDocument, LegalList, LegalParagraph, type LegalSection } from '@/components/legal/legal-document'
import { TERMS_EFFECTIVE_DATE, TERMS_VERSION } from '@/lib/terms'

function Em({ children }: { children: ReactNode }) {
  return <span style={{ color: '#0f1419', fontWeight: 600 }}>{children}</span>
}

const sections: LegalSection[] = [
  {
    heading: '제1조 (총칙)',
    body: (
      <LegalParagraph>
        Jaroo(이하 “회사”)는 개인정보보호법에 따라 이용자의 개인정보를 보호하고, 이용자가 안심하고 서비스를 이용할 수 있도록 처리 목적·항목·보유 기간 등을 이 개인정보처리방침으로
        안내합니다. 이 방침은 Jaroo 앱·웹 서비스 전체에 적용됩니다.
      </LegalParagraph>
    ),
  },
  {
    heading: '제2조 (처리 목적과 수집 항목)',
    body: (
      <>
        <LegalList
          items={[
            <>
              <Em>회원 가입 및 인증</Em>: 이메일 주소, 비밀번호(암호화 저장), 이름/표시 이름, 로그인 제공자 정보(Google 등) — 계정 생성·식별·인증 목적
            </>,
            <>
              <Em>서비스 제공</Em>: 포트폴리오 보유 종목 정보(종목명·수량·평가금액 등), 분석 이력 — AI 분석·포트폴리오 진단·기록 관리 목적
            </>,
            <>
              <Em>결제 및 크레딧 관리</Em>: 결제 식별자·주문 내역·크레딧 잔액 — 유료 서비스 제공·결제 처리·민원 처리 목적 (신용카드 번호 등 결제 수단 정보는 (주)토스페이먼츠가
              처리하며 회사가 저장하지 않습니다)
            </>,
            <>
              <Em>자동 생성 정보</Em>: 쿠키(인증 세션), 접속 로그, 서비스 이용 기록 — 세션 유지·서비스 개선·부정 이용 방지 목적
            </>,
          ]}
        />
        <LegalParagraph>
          <Em>MTS 스크린샷은 OCR(문자 인식) 분석 목적으로만 사용되며, 분석이 끝나면 즉시 안전하게 파기합니다. 신용등급, 건강정보 등 법령상 민감정보는 수집하지 않습니다.</Em>
        </LegalParagraph>
      </>
    ),
  },
  {
    heading: '제3조 (보유 및 이용 기간)',
    body: (
      <LegalParagraph>
        회원의 개인정보는 회원 탈퇴 시 지체 없이 파기합니다. 다만 관련 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다. 예를 들어 전자상거래 등에서의
        소비자보호에 관한 법률에 따라 계약·청약철회 기록은 5년, 표시·광고에 관한 기록은 6개월간 보관할 수 있습니다. 회원이 오랫동안 로그인하지 않는 경우에도 법령상
        보존 기간이 지나면 파기·분리 보관합니다.
      </LegalParagraph>
    ),
  },
  {
    heading: '제4조 (처리 위탁 및 제3자 제공)',
    body: (
      <>
        <LegalParagraph>회사는 서비스 운영을 위해 다음과 같이 개인정보 처리를 위탁하고 있습니다.</LegalParagraph>
        <LegalList
          items={[
            <>
              <Em>Supabase</Em> (인증·데이터베이스 호스팅): 계정 정보, 포트폴리오, 분석 기록 저장
            </>,
            <>
              <Em>(주)토스페이먼츠</Em> (결제대행): 결제 처리 및 결제 수단 인증
            </>,
            <>
              <Em>OpenRouter 및 AI 모델 제공사</Em> (AI 분석·OCR): 분석 요청에 필요한 최소한의 종목·포트폴리오 정보
            </>,
            <>
              <Em>Google</Em> (소셜 로그인): OAuth 계정 연결 시 이메일·프로필 정보
            </>,
            <>
              <Em>호스팅 사업자</Em> (클라우드 인프라): 서비스 운영·로그 보관
            </>,
          ]}
        />
        <LegalParagraph>
          회사는 이용자의 개인정보를 원칙적으로 제3자에게 제공하지 않습니다. 다만 이용자가 사전에 동의한 경우나 법령에 특별한 규정이 있는 경우에만 제공합니다.
        </LegalParagraph>
      </>
    ),
  },
  {
    heading: '제5조 (이용자의 권리와 행사 방법)',
    body: (
      <LegalParagraph>
        이용자는 언제든지 자신의 개인정보를 열람·정정·삭제할 수 있고, 처리를 일시 정지하거나 동의를 철회할 수 있습니다. 마이페이지에서 프로필 수정·회원 탈퇴를 직접
        할 수 있으며, 그 외 요청은 support@jaroo.kr 로 보내주시면 지체 없이 처리하겠습니다. 만 14세 미만 아동의 법정대리인은 아동의 개인정보 열람·정정·삭제를 요구할 수
        있습니다.
      </LegalParagraph>
    ),
  },
  {
    heading: '제6조 (파기 절차와 방법)',
    body: (
      <LegalParagraph>
        개인정보는 보유 기간의 경과, 처리 목적 달성 등 개인정보가 불필요하게 되었을 때 지체 없이 파기합니다. 전자적 형태의 개인정보는 복구·재생할 수 없는 기술적 방법으로
        파기하며, 종이 문서는 분쇄 또는 소각하여 파기합니다. 회원 탈퇴 시 계정·포트폴리오·분석 기록·잔여 크레딧이 함께 삭제됩니다.
      </LegalParagraph>
    ),
  },
  {
    heading: '제7조 (만 14세 미만 아동)',
    body: (
      <LegalParagraph>
        회사의 서비스는 만 14세 이상을 대상으로 하며, 만 14세 미만 아동의 개인정보를 수집하지 않습니다. 만 14세 미만 아동이 회원가입을 시도한 경우 삭제 조치합니다.
      </LegalParagraph>
    ),
  },
  {
    heading: '제8조 (쿠키 운용)',
    body: (
      <LegalParagraph>
        회사는 로그인 상태 유지를 위해 인증 세션 쿠키를 사용합니다. 이 쿠키는 로그인 유지에 필수적이며, 브라우저 설정에서 차단할 수 있지만 그 경우 로그인이 유지되지
        않을 수 있습니다.
      </LegalParagraph>
    ),
  },
  {
    heading: '제9조 (개인정보 보호책임자와 문의)',
    body: (
      <LegalParagraph>
        개인정보 처리에 관한 문의·불만·상담은 support@jaroo.kr 로 보내주세요. 접수 후 지체 없이 답변드리겠습니다. 회사의 개인정보 처리가 부적절하다고 판단되는 경우
        개인정보보호위원회 등 감독기관에 상담할 수 있습니다.
      </LegalParagraph>
    ),
  },
  {
    heading: '제10조 (방침 변경)',
    body: (
      <LegalParagraph>
        이 개인정보처리방침이 변경되는 경우 변경 사항을 서비스 내에 공지합니다. 중대한 변경은 최소 7일 전 공지하며, 변경된 방침은 시행일부터 효력이 있습니다.
      </LegalParagraph>
    ),
  },
]

export const metadata = {
  title: '개인정보처리방침 | Jaroo',
}

export default function PrivacyPage() {
  return (
    <LegalDocument
      title='개인정보처리방침'
      meta={`시행일 ${TERMS_EFFECTIVE_DATE} · 버전 ${TERMS_VERSION}`}
      sections={sections}
    />
  )
}
