import type { StoreInfo } from "../../data/releaseInfo";

interface Props {
  stores: StoreInfo[];
  className?: string;
}

export default function AlsoAvailableLinks({ stores, className }: Props) {
  return (
    <p className={className}>
      Also available for{" "}
      {stores.map((store, i) => (
        <span key={store.id}>
          <a
            href={store.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-white"
          >
            {store.name}
          </a>
          {i < stores.length - 1 ? " · " : ""}
        </span>
      ))}
    </p>
  );
}
