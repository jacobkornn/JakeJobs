import { IpcMain } from "electron";
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

export function registerClaudeHandlers(ipcMain: IpcMain) {
  ipcMain.handle("claude:deduplicateCompanies", async (_event, jobs: Array<Record<string, string>>) => {
    const anthropic = getClient();

    // Group jobs by company for efficient processing
    const companiesSeen = new Map<string, Record<string, string>[]>();
    for (const job of jobs) {
      const name = job.companyName || job.company || "";
      const key = name.toLowerCase().trim();
      if (!companiesSeen.has(key)) companiesSeen.set(key, []);
      companiesSeen.get(key)!.push(job);
    }

    const companyList = Array.from(companiesSeen.entries()).map(([key, jobs]) => ({
      name: jobs[0].companyName || jobs[0].company,
      domain: jobs[0].website || jobs[0].companyDomain || "",
      jobCount: jobs.length,
      variations: [...new Set(jobs.map((j) => j.companyName || j.company))],
    }));

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `You are a data analyst. I have a list of companies from job postings.
Deduplicate them (merge variations like "Acme Inc" / "Acme, Inc." / "ACME"),
and for each unique company, provide the LinkedIn company URL if you can infer it from the company name and domain.

Return JSON only, no markdown. Format:
[{"name": "Canonical Name", "linkedinUrl": "https://linkedin.com/company/slug", "website": "https://domain.com", "variations": ["Name1", "Name2"]}]

Companies:
${JSON.stringify(companyList, null, 2)}`,
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    try {
      return JSON.parse(text);
    } catch {
      // Try extracting JSON from response
      const match = text.match(/\[[\s\S]*\]/);
      return match ? JSON.parse(match[0]) : [];
    }
  });

  ipcMain.handle("claude:suggestJobTitles", async (_event, companies: Array<Record<string, string>>) => {
    const anthropic = getClient();

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Based on these companies and their industries, suggest job titles I should search for in LinkedIn Sales Navigator to find relevant decision-makers (hiring managers, team leads, VPs).

I'm a software engineer/sales professional looking for contacts who would be involved in hiring decisions.

Return JSON only, no markdown. Format:
["VP of Engineering", "Head of Sales", ...]

Companies:
${JSON.stringify(companies.slice(0, 50).map((c) => ({ name: c.name, domain: c.website || c.domain })), null, 2)}`,
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      return match ? JSON.parse(match[0]) : [];
    }
  });

  ipcMain.handle(
    "claude:personalizeEmails",
    async (
      _event,
      params: {
        contacts: Array<Record<string, string>>;
        template: string;
        jobs: Array<Record<string, string>>;
      }
    ) => {
      const anthropic = getClient();

      // Group contacts by company for batch personalization
      const byCompany = new Map<string, Array<Record<string, string>>>();
      for (const contact of params.contacts) {
        const company = contact.company || "Unknown";
        if (!byCompany.has(company)) byCompany.set(company, []);
        byCompany.get(company)!.push(contact);
      }

      const results: Array<{ contactEmail: string; subject: string; body: string }> = [];

      for (const [company, contacts] of byCompany) {
        const relatedJobs = params.jobs.filter(
          (j) => (j.companyName || j.company || "").toLowerCase() === company.toLowerCase()
        );

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-5-20250514",
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: `Personalize this email template for outreach to contacts at "${company}".

Make SUBTLE changes only:
- Mention something specific about the company (from the job descriptions below)
- Slightly adjust tone for the role type
- Keep it feeling personal, NOT like a full rewrite
- Each contact gets their own version

Base template:
${params.template}

Contacts at ${company}:
${JSON.stringify(contacts.map((c) => ({ name: c.fullname || `${c.firstname} ${c.lastname}`, title: c.jobtitle, email: c.email || c.emailaddress1 })), null, 2)}

Related job postings:
${JSON.stringify(relatedJobs.map((j) => ({ title: j.cr21a_jobtitle || j.jobTitle, description: j.cr21a_jobdescription || j.description || "" })).slice(0, 5), null, 2)}

Return JSON only, no markdown. Format:
[{"contactEmail": "email@example.com", "subject": "Subject line", "body": "Email body HTML"}]`,
            },
          ],
        });

        const text = response.content[0].type === "text" ? response.content[0].text : "";
        try {
          const parsed = JSON.parse(text);
          results.push(...parsed);
        } catch {
          const match = text.match(/\[[\s\S]*\]/);
          if (match) results.push(...JSON.parse(match[0]));
        }
      }

      return results;
    }
  );
}
