// Yoco hosted-fields payment — owner: Mine (task M4)
// NEVER render raw card fields. Use Yoco SDK hosted-fields iframe only (rule L01).

export type Props = {
  clientSecret: string;
  amountZar: number;
  onSuccess: (yocoPaymentId: string) => void;
};

// TODO (M4): embed Yoco hosted-fields iframe + handle success/failure
export default function YocoPayment(_props: Props) {
  return <div>YocoPayment — task M4</div>;
}
