export interface ParsedOrangeMoneySms {
  amount: number;
  senderPhone: string;
  senderName: string;
  newBalance: number;
  transactionId: string;
}

/**
 * Parseur pour un SMS de RECEPTION Orange Money (celui du telephone qui
 * recoit l'argent, pas celui qui envoie). Format confirme le 26/09/2026
 * sur un vrai SMS - voir cahier des charges section 5.
 *
 * Exemple reel :
 * "Vous avez recu 500.0 FCFA, Frais:  FCFA, Taxe:  FCFA du 07802610,Spierreclavers.
 *  Le solde de votre compte est de 579.0 FCFA. Trans id: MP260926.1442.95750390."
 */
export function parseOrangeMoneyReceptionSms(smsText: string): ParsedOrangeMoneySms | null {
  const regex = /Vous avez recu ([\d.]+)\s*FCFA.*?du (\d+),(\S+)\.\s*Le solde de votre compte est de ([\d.]+)\s*FCFA\.\s*Trans id:\s*(\S+)\./;
  const match = smsText.match(regex);

  if (!match) {
    return null;
  }

  const [, amount, senderPhone, senderName, newBalance, transactionId] = match;

  return {
    amount: parseFloat(amount),
    senderPhone: normalizePhoneNumber(senderPhone.trim()),
    senderName: senderName.trim(),
    newBalance: parseFloat(newBalance),
    transactionId: transactionId.trim(),
  };
}

/**
 * Normalise un numero court (8 chiffres, ex: 07802610) vers le format
 * avec indicatif Burkina Faso (226) pour matcher declared_payment_phone.
 * A ajuster si le format de declared_payment_phone est different.
 */
export function normalizePhoneNumber(phone: string): string {
  const digitsOnly = phone.replace(/\D/g, '');
  if (digitsOnly.length === 8) {
    return `226${digitsOnly}`;
  }
  return digitsOnly;
}
