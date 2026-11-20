// Ce que le DNS public d'un domaine dit de l'informatique d'une société
// (gratuit, sans appel tiers) : messagerie (MX), services déclarés (SPF),
// vérifications de domaine (TXT : Microsoft 365, Google, Atlassian…).
import { promises as dns } from "node:dns";

const MAIL = [
  { label: "Microsoft 365", re: /\.mail\.protection\.outlook\.com$|\.outlook\.com$/i },
  { label: "Google Workspace", re: /google\.com$|googlemail\.com$/i },
  { label: "OVHcloud (mail)", re: /\.ovh\.net$|\.ovh\.com$/i },
  { label: "Ionos (mail)", re: /\.ionos\.|\.kundenserver\.de$|\.1and1\./i },
  { label: "Gandi (mail)", re: /\.gandi\.net$/i },
  { label: "Orange (mail)", re: /orange\.fr$|wanadoo\.fr$/i },
  { label: "Zimbra / BlueMind / messagerie interne", re: /zimbra|bluemind/i },
];
const GATEWAYS = [
  { label: "Mimecast", re: /mimecast/i },
  { label: "Proofpoint", re: /pphosted|proofpoint/i },
  { label: "Vade", re: /vadesecure|vade\./i },
  { label: "Barracuda", re: /barracuda/i },
  { label: "Cisco Secure Email", re: /iphmx\.com/i },
  { label: "Trend Micro", re: /trendmicro|tmes\./i },
  { label: "Altospam", re: /altospam/i },
  { label: "MailInBlack", re: /mailinblack/i },
];
const SPF_SERVICES = [
  { label: "Microsoft 365", re: /spf\.protection\.outlook\.com/i },
  { label: "Google Workspace", re: /_spf\.google\.com/i },
  { label: "Salesforce", re: /salesforce\.com/i },
  { label: "HubSpot", re: /hubspot/i },
  { label: "Mailchimp", re: /servers\.mcsv\.net|mailchimp/i },
  { label: "Brevo (Sendinblue)", re: /sendinblue|brevo/i },
  { label: "SendGrid", re: /sendgrid/i },
  { label: "Zendesk", re: /zendesk/i },
  { label: "Freshdesk", re: /freshdesk/i },
  { label: "Amazon SES", re: /amazonses/i },
  { label: "OVHcloud", re: /mx\.ovh\.com|ovh/i },
];
const TXT_VERIFS = [
  { label: "Microsoft 365", re: /^MS=ms\d+/i },
  { label: "Google Workspace", re: /^google-site-verification=/i },
  { label: "Atlassian (Jira / Confluence)", re: /^atlassian-domain-verification=/i },
  { label: "DocuSign", re: /^docusign=/i },
  { label: "Adobe", re: /^adobe-idp-site-verification=/i },
  { label: "Apple Business", re: /^apple-domain-verification=/i },
  { label: "Zoom", re: /^ZOOM_verify_/i },
  { label: "Cisco Webex", re: /^webexdomainverification/i },
  { label: "Slack", re: /^slack-domain-verification/i },
  { label: "Dropbox", re: /^dropbox-domain-verification/i },
  { label: "Facebook / Meta", re: /^facebook-domain-verification=/i },
  { label: "Salesforce", re: /^(sfdc|salesforce)-?(domain-)?verification/i },
  { label: "Miro", re: /^miro-verification/i },
  { label: "Zscaler", re: /^zscaler-verification/i },
  { label: "Okta", re: /^okta-verification/i },
];

/** Classement pur des enregistrements DNS. */
export function classifyDns({ mx = [], txt = [] } = {}) {
  const hosts = mx.map((m) => String(m.exchange || m).toLowerCase()).filter(Boolean);
  const flat = txt.map((t) => (Array.isArray(t) ? t.join("") : String(t)));
  const spf = flat.find((t) => /^v=spf1/i.test(t)) || "";

  const services = new Set();
  const mail = MAIL.find((p) => hosts.some((h) => p.re.test(h)))?.label || null;
  const gateway = GATEWAYS.find((p) => hosts.some((h) => p.re.test(h)))?.label || null;
  if (mail) services.add(mail.replace(/ \(mail\)$/, ""));
  for (const s of SPF_SERVICES) if (s.re.test(spf)) services.add(s.label);
  for (const v of TXT_VERIFS) if (flat.some((t) => v.re.test(t))) services.add(v.label);
  // Passerelle de sécurité devant la messagerie : l'hébergeur réel est souvent dans le SPF.
  const mailProvider = mail
    || (gateway && (/spf\.protection\.outlook\.com/i.test(spf) ? "Microsoft 365" : /_spf\.google\.com/i.test(spf) ? "Google Workspace" : null))
    || (hosts.length ? "Autre / interne" : null);

  return {
    has_mx: hosts.length > 0,
    mx: hosts.slice(0, 4),
    mail_provider: mailProvider,
    mail_gateway: gateway,
    services: [...services],
    dmarc: null,
  };
}

const safe = (p) => p.catch(() => []);

/** Interroge le DNS public d'un domaine (≈ 3 requêtes, < 1 s). */
export async function dnsIntel(domain) {
  if (!domain) return null;
  const [mx, txt, dmarc] = await Promise.all([
    safe(dns.resolveMx(domain)),
    safe(dns.resolveTxt(domain)),
    safe(dns.resolveTxt(`_dmarc.${domain}`)),
  ]);
  const out = classifyDns({ mx, txt });
  const d = dmarc.map((t) => t.join("")).find((t) => /^v=DMARC1/i.test(t));
  out.dmarc = d ? (/p=(reject|quarantine|none)/i.exec(d)?.[1]?.toLowerCase() || "présent") : null;
  return out;
}

/** Le domaine existe-t-il (résolution A ou AAAA) ? */
export async function domainResolves(domain) {
  try {
    await dns.lookup(domain);
    return true;
  } catch {
    return false;
  }
}
