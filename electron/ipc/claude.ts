import { IpcMain } from "electron";
import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: (process.env.ANTHROPIC_API_KEY || "").trim() });
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
      model: "claude-sonnet-4-20250514",
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
      model: "claude-sonnet-4-20250514",
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
        leadType?: string;
      }
    ) => {
      const anthropic = getClient();
      const fs = await import("fs");
      const path = await import("path");

      // Load resume text for context
      const lt = (params.leadType || "engineering").toLowerCase();
      const resumeDir = lt === "sales"
        ? path.join(__dirname, "..", "..", "..", "Wiza", "Data", "Sales")
        : path.join(__dirname, "..", "..", "..", "Wiza", "Data", "Software");
      const resumePath = path.join(resumeDir, "Jacob_Korn_Resume.pdf");

      let resumeText = "";
      try {
        const pdfParse = require("pdf-parse");
        const buf = fs.readFileSync(resumePath);
        const pdfData = await pdfParse(buf);
        resumeText = pdfData.text.slice(0, 4000);
      } catch {
        resumeText = "";
      }

      // Group contacts by company for batch personalization
      const byCompany = new Map<string, Array<Record<string, string>>>();
      for (const contact of params.contacts) {
        const company = contact.company || contact.accountName || "";
        if (!company) continue;
        if (!byCompany.has(company)) byCompany.set(company, []);
        byCompany.get(company)!.push(contact);
      }

      const results: Array<{ contactEmail: string; subject: string; body: string }> = [];

      for (const [company, contacts] of byCompany) {
        const relatedJobs = params.jobs.filter(
          (j) => (j.accountName || j.companyName || j.company || j.cr21a_companyname || "").toLowerCase() === company.toLowerCase()
        );

        // Get the primary job title for this company — this MUST appear in every email
        const primaryJobTitle = relatedJobs.length > 0
          ? (relatedJobs[0].cr21a_jobtitle || relatedJobs[0].jobTitle || "")
          : "";

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4096,
          messages: [
            {
              role: "user",
              content: `Personalize this email template for outreach to contacts at "${company}".

THE JOB I APPLIED FOR: "${primaryJobTitle}" at ${company}
${primaryJobTitle ? `Every single email MUST contain the exact phrase "I recently applied for the ${primaryJobTitle} position at ${company}". This is NON-NEGOTIABLE.` : `No specific job title found — use "I recently came across ${company}" instead.`}

STRICT RULES:
1. DO NOT mention the company's mission, values, or vision — it comes across as generic and cheesy
2. Make personalization SPECIFIC to the job posting requirements and the lead's role/title
3. Reference specific skills, technologies, or responsibilities from the job description that align with my resume
4. Tailor the pitch to what the lead cares about given their role (e.g. a VP of Engineering cares about technical depth; a Sales Director cares about revenue impact)
5. DO NOT change the greeting line ("Hi {name},") or the signature block — keep the signature (Best, Jacob Korn, phone, LinkedIn link) EXACTLY as-is
6. The LinkedIn link <a href="https://www.linkedin.com/in/jacob-korn-3aa792248/">My LinkedIn</a> MUST remain
7. Keep the HTML structure and <br> tags intact — every line break in the template must remain as <br>
8. Subject should be: "Introduction - Interested in ${company}" unless the job posting suggests a more specific angle
9. Keep the email body to ONE paragraph only — do NOT add extra paragraphs or make it longer than the template
10. Do NOT take any creative liberty — do not embellish, invent, or exaggerate anything. My resume is the ONLY source of truth for my experience and skills. If it's not on the resume, do not claim it.
11. Keep the email SHORT — same length as the template. Do not make it longer or more detailed.
12. If the contact's job title looks like a system-generated format with commas or slashes (e.g. "IT Project Manager, Infrastructure" or "Senior Engineer / Platform"), clean it up to read naturally in the email. For example, "IT Project Manager, Infrastructure" → "IT Project Manager" or rephrase as "your role in IT project management". It should never look autofilled.
13. NEVER say "I applied for a position" or "a role" generically — the job title "${primaryJobTitle}" MUST appear by name.

My resume (${lt}):
${resumeText || "(resume not available)"}

Base template (HTML):
${params.template}

Contacts at ${company}:
${JSON.stringify(contacts.map((c) => ({ name: c.fullname || `${c.firstname} ${c.lastname}`, title: c.jobtitle, email: c.email || c.emailaddress1 })), null, 2)}

Related job postings:
${JSON.stringify(relatedJobs.map((j) => ({ title: j.cr21a_jobtitle || j.jobTitle, description: j.cr21a_jobdescription || j.description || "" })).slice(0, 5), null, 2)}

Return JSON only, no markdown. Format:
[{"contactEmail": "email@example.com", "subject": "Subject line", "body": "Full HTML email body"}]`,
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
