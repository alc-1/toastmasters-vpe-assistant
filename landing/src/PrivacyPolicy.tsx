import Footer from "./components/layout/Footer";
import Header from "./components/layout/Header";
import Section from "./components/ui/Section";
import SectionHeading from "./components/ui/SectionHeading";

const CONTACT_EMAIL = "toastmasters@alcosta.ch";

const bodyText = "text-navy-700 leading-relaxed";

function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 grid gap-3">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3 text-navy-700">
          <span aria-hidden="true" className="mt-0.5 text-navy-700">
            &#10003;
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function CrossList({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 grid gap-3">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3 text-navy-700">
          <span aria-hidden="true" className="mt-0.5 text-navy-700">
            &#10007;
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function PrivacyPolicy() {
  return (
    <>
      <Header page="privacy" />
      <main>
        <Section tone="white" narrow>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-navy-950">
            Privacy Policy for Toastmasters VPE Assistant
          </h1>
          <p className="mt-3 text-sm font-medium text-navy-700">Effective date: August 6, 2026</p>
          <p className={`mt-6 text-lg ${bodyText}`}>
            Toastmasters VPE Assistant is a Chrome extension built to help Toastmasters Vice
            Presidents of Education (VPEs) get a unified view of members' Pathways progress, by
            reading data already visible to them on Basecamp and EasySpeak. This page explains what
            information the extension accesses, how it's used, and — most importantly — that it
            never leaves your browser.
          </p>
        </Section>

        <Section id="data-accessed" tone="alt" narrow>
          <SectionHeading align="left" title="1. Data Accessed and Used" />
          <p className={`mt-6 ${bodyText}`}>
            When you ask the extension to generate a report, it reads the content of pages you're
            already logged into on Toastmasters Basecamp and EasySpeak. Depending on what's
            displayed on those pages, this may include:
          </p>
          <CheckList
            items={[
              "Club information",
              "Member names",
              "Pathways paths",
              "Level completion information",
              "Progress information",
            ]}
          />
          <p className={`mt-6 ${bodyText}`}>
            This information is used only to generate the reports you request — matching clubs,
            members, and paths between the two systems and showing you a combined progress view.
          </p>
        </Section>

        <Section id="local-processing" tone="navy" narrow>
          <SectionHeading
            align="left"
            tone="light"
            eyebrow="Prominent notice"
            title="2. Local Processing"
          />
          <ul className="mt-6 grid gap-3">
            {[
              "All data is processed locally, inside your own browser.",
              "Nothing is transmitted to any external server.",
              "The extension does not maintain a remote database of any kind.",
              "The developer cannot access your club's member data — there's simply nowhere for it to go.",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 text-navy-50">
                <span aria-hidden="true" className="mt-0.5 text-yellow-accent">
                  &#10003;
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="local-storage" tone="white" narrow>
          <SectionHeading align="left" title="3. Local Storage" />
          <p className={`mt-6 ${bodyText}`}>
            The extension uses your browser's local storage only to remember:
          </p>
          <CheckList
            items={["Your preferences", "Configuration settings", "Confirmed matching decisions"]}
          />
          <p className={`mt-6 ${bodyText}`}>
            This stored information stays on your device. It is never uploaded anywhere.
          </p>
        </Section>

        <Section id="permissions" tone="alt" narrow>
          <SectionHeading align="left" title="4. Permissions Explanation" />
          <div className="mt-6 grid gap-6">
            <div>
              <h3 className="text-lg font-semibold text-navy-950">Storage permission</h3>
              <p className={`mt-2 ${bodyText}`}>
                Used to save your preferences and matching decisions on your device.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-navy-950">Scripting permission</h3>
              <p className={`mt-2 ${bodyText}`}>
                Used to extract information displayed on Basecamp and EasySpeak pages you're
                already logged into.
              </p>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-navy-950">Host permissions</h3>
              <p className={`mt-2 ${bodyText}`}>
                Used only to access the Basecamp and EasySpeak pages required for the extension to
                function.
              </p>
            </div>
          </div>
        </Section>

        <Section id="authentication" tone="white" narrow>
          <SectionHeading align="left" title="5. Authentication" />
          <CheckList
            items={[
              "The extension never asks you for a password.",
              "It relies entirely on your existing, already-authenticated browser sessions.",
              "Authentication information is never stored or transmitted by the extension.",
            ]}
          />
        </Section>

        <Section id="data-sharing" tone="alt" narrow>
          <SectionHeading align="left" title="6. Data Sharing" />
          <CrossList
            items={[
              "No data is sold.",
              "No data is shared with third parties.",
              "No data is used for advertising.",
              "No data is used for profiling.",
            ]}
          />
        </Section>

        <Section id="data-retention" tone="white" narrow>
          <SectionHeading align="left" title="7. Data Retention and Deletion" />
          <p className={`mt-6 ${bodyText}`}>
            Data stored locally by the extension can be removed at any time by uninstalling the
            extension or clearing its storage from your browser's extension settings. You are
            always in control of the information stored on your own device.
          </p>
        </Section>

        <Section id="user-responsibility" tone="alt" narrow>
          <SectionHeading align="left" title="8. User Responsibility" />
          <p className={`mt-6 ${bodyText}`}>
            You should only use this extension with data you are authorized to access. Toastmasters
            officers remain responsible for complying with their club's and district's applicable
            policies when handling member information.
          </p>
        </Section>

        <Section id="contact" tone="white" narrow>
          <SectionHeading align="left" title="9. Contact" />
          <p className={`mt-6 ${bodyText}`}>
            Questions about this privacy policy can be sent to:{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-navy-950 underline">
              {CONTACT_EMAIL}
            </a>
          </p>
        </Section>
      </main>
      <Footer />
    </>
  );
}
